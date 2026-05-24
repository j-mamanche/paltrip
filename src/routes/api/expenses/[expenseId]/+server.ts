import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireMember, getMemberId } from '$lib/server/auth';
import { validateAmount, validateSettlementType, validateCategory, validateOptionalText, validateCurrency, validateExchangeRate } from '$lib/server/validate';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { expenseId } = params;
  const memberId = getMemberId(request);

  const { data: existing } = await supabase
    .from('expenses').select('trip_id, paid_by').eq('id', expenseId).single();
  if (!existing) throw error(404, 'Gasto no encontrado');

  // Allow admin or the person who paid
  await requireMember(existing.trip_id, memberId);
  const { data: member } = await supabase.from('trip_users').select('role').eq('id', memberId).single();
  if (member?.role !== 'admin' && existing.paid_by !== memberId) {
    throw error(403, 'Solo el pagador o un administrador puede editar este gasto');
  }

  const { description, amount_total, paid_by, settlement_type, category, participants } = body;

  const amount = validateAmount(amount_total);
  const sType = validateSettlementType(settlement_type ?? 'deferred');
  const cat = validateCategory(category ?? 'general');
  const desc = validateOptionalText(description, 500) ?? '';
  const splitMode = ['equal', 'weighted', 'itemized'].includes(body.split_mode) ? body.split_mode : 'equal';
  const tipAmount = Math.max(0, Number(body.tip_amount) || 0);
  const tipMode = body.tip_mode === 'flat' ? 'flat' : 'proportional';

  // Multi-currency
  const { data: trip } = await supabase.from('trips').select('currency').eq('id', existing.trip_id).single();
  const baseCurrency = trip?.currency as string;
  const expCurrency = body.currency ? validateCurrency(body.currency) : baseCurrency;
  const exchRate = expCurrency !== baseCurrency ? validateExchangeRate(body.exchange_rate ?? 1) : 1;
  const amtBase = Math.round(amount * exchRate * 100) / 100;

  await query(() =>
    supabase.from('expenses').update({
      description: desc, amount_total: amount,
      currency: expCurrency, original_currency: expCurrency, original_amount: amount,
      exchange_rate: exchRate, amount_base: amtBase,
      paid_by: paid_by ?? existing.paid_by,
      settlement_type: sType, category: cat,
      split_mode: splitMode, tip_amount: tipAmount, tip_mode: tipMode
    }).eq('id', expenseId).select().single()
  );

  // Replace participants
  if (participants) {
    await supabase.from('expense_participants').delete().eq('expense_id', expenseId);
    await query(() =>
      supabase.from('expense_participants').insert(
        participants.map((p: { user_id: string; weight?: number }) => ({
          expense_id: expenseId, user_id: p.user_id, weight: p.weight ?? 1.0
        }))
      ).select()
    );
  }

  // Replace items for itemized splits
  await supabase.from('expense_items').delete().eq('expense_id', expenseId);
  if (splitMode === 'itemized' && Array.isArray(body.items) && body.items.length > 0) {
    await insertItems(expenseId, body.items);
  }

  const data = await query(() =>
    supabase.from('expenses')
      .select('*, payer:paid_by(id,name), participants:expense_participants(*, member:user_id(id,name)), items:expense_items(*, assignments:expense_item_assignments(user_id))')
      .eq('id', expenseId).single()
  );

  return json(data);
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const { expenseId } = params;
  const memberId = getMemberId(request);

  const { data: existing } = await supabase.from('expenses').select('trip_id, paid_by').eq('id', expenseId).single();
  if (!existing) throw error(404, 'Gasto no encontrado');

  await requireMember(existing.trip_id, memberId);
  const { data: member } = await supabase.from('trip_users').select('role').eq('id', memberId).single();
  if (member?.role !== 'admin' && existing.paid_by !== memberId) {
    throw error(403, 'Solo el pagador o un administrador puede eliminar este gasto');
  }

  await supabase.from('expenses').delete().eq('id', expenseId);
  return new Response(null, { status: 204 });
};

type ItemPayload = { description: string; quantity: number; unit_price: number; amount: number; assignees: string[] };

async function insertItems(expenseId: string, items: ItemPayload[]) {
  const itemRows = items.map((i) => ({
    expense_id: expenseId,
    description: i.description ?? '',
    quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
    unit_price: Math.max(0, Number(i.unit_price) || 0),
    amount: Math.max(0, Number(i.amount) || 0)
  }));

  const inserted = await query(() => supabase.from('expense_items').insert(itemRows).select('id'));

  const assignmentRows = (inserted as { id: string }[]).flatMap((item, idx) =>
    (items[idx].assignees ?? []).map((userId: string) => ({ item_id: item.id, user_id: userId }))
  );

  if (assignmentRows.length > 0) {
    await query(() => supabase.from('expense_item_assignments').insert(assignmentRows).select());
  }
}
