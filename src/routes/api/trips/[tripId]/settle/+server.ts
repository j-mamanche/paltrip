import { json } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireAdmin, getMemberId } from '$lib/server/auth';
import { computeBalances, optimizeTransfers, roundTransfers } from '$lib/engines/balance';
import type { RequestHandler } from './$types';
import type { Expense } from '$lib/types';

export const POST: RequestHandler = async ({ params, request }) => {
  const { tripId } = params;
  await requireAdmin(tripId, getMemberId(request));

  const body = await request.json().catch(() => ({}));
  const granularity: number = body.granularity ?? 1000;

  await supabase.from('settlements').delete().eq('trip_id', tripId).eq('status', 'pending');

  const expenses = await query(() =>
    supabase
      .from('expenses')
      .select('*, payer:paid_by(id,name), participants:expense_participants(*, member:user_id(id,name))')
      .eq('trip_id', tripId)
      .eq('status', 'confirmed')
  );

  const balances = computeBalances(expenses as Expense[]);
  const raw = optimizeTransfers(balances);
  const rounded = granularity > 1 ? roundTransfers(raw, granularity) : raw;

  const rows = rounded
    .filter((t) => t.amount > 0)
    .map((t) => ({
      trip_id: tripId,
      from_user: t.from_user,
      to_user: t.to_user,
      amount: t.amount,
      status: 'pending'
    }));

  if (rows.length === 0) return json({ settlements: [] });

  // payment_ref solo en settlements (quien recibe el pago)
  const settlements = await query(() =>
    supabase
      .from('settlements')
      .insert(rows)
      .select('*, from:from_user(id,name), to:to_user(id,name,payment_ref)')
  );

  return json({ settlements }, { status: 201 });
};
