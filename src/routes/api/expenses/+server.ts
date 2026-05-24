import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireMember, getMemberId } from '$lib/server/auth';
import { validateAmount, validateSettlementType, validateCategory, validateOptionalText, validateCurrency, validateExchangeRate } from '$lib/server/validate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { trip_id, description, amount_total, paid_by, settlement_type, category, participants } = body;

  if (!trip_id || !paid_by || !participants?.length) throw error(400, 'Faltan campos requeridos');

  await requireMember(trip_id, getMemberId(request));

  const amount = validateAmount(amount_total);
  const sType = validateSettlementType(settlement_type ?? 'deferred');
  const cat = validateCategory(category ?? 'general');
  const desc = validateOptionalText(description, 500) ?? '';
  const splitMode = ['equal', 'weighted', 'itemized'].includes(body.split_mode) ? body.split_mode : 'equal';
  const tipAmount = Math.max(0, Number(body.tip_amount) || 0);
  const tipMode = body.tip_mode === 'flat' ? 'flat' : 'proportional';

  // Multi-currency
  const trip = await query(() => supabase.from('trips').select('currency').eq('id', trip_id).single());
  const baseCurrency = trip.currency as string;
  const expCurrency = body.currency ? validateCurrency(body.currency) : baseCurrency;
  const exchRate = expCurrency !== baseCurrency ? validateExchangeRate(body.exchange_rate ?? 1) : 1;
  const amtBase = Math.round(amount * exchRate * 100) / 100;

  const expense = await query(() =>
    supabase.from('expenses').insert({
      trip_id, description: desc,
      amount_total: amount, currency: expCurrency,
      original_currency: expCurrency, original_amount: amount,
      exchange_rate: exchRate, amount_base: amtBase,
      paid_by, settlement_type: sType, category: cat,
      split_mode: splitMode, tip_amount: tipAmount, tip_mode: tipMode,
      status: 'confirmed'
    }).select().single()
  );

  await query(() =>
    supabase.from('expense_participants').insert(
      participants.map((p: { user_id: string; weight?: number }) => ({
        expense_id: expense.id, user_id: p.user_id, weight: p.weight ?? 1.0
      }))
    ).select()
  );

  // Store individual items for itemized splits
  if (splitMode === 'itemized' && Array.isArray(body.items) && body.items.length > 0) {
    await insertItems(expense.id, body.items);
  }

  return json(expense, { status: 201 });
};

type ItemPayload = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  assignees: string[];
};

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
