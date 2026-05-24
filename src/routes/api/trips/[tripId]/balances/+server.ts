import { json } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireMember, getMemberId } from '$lib/server/auth';
import { computeBalances, optimizeTransfers } from '$lib/engines/balance';
import type { RequestHandler } from './$types';
import type { Expense } from '$lib/types';

export const GET: RequestHandler = async ({ params, request }) => {
  const { tripId } = params;
  await requireMember(tripId, getMemberId(request));

  const expenses = await query(() =>
    supabase
      .from('expenses')
      .select('*, payer:paid_by(id,name), participants:expense_participants(*, member:user_id(id,name))')
      .eq('trip_id', tripId)
      .eq('status', 'confirmed')
  );

  const balances = computeBalances(expenses as Expense[]);
  const transfers = optimizeTransfers(balances);

  return json({ balances, transfers });
};
