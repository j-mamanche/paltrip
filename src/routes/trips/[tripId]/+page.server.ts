import { error } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabase';
import { computeBalances, optimizeTransfers } from '$lib/engines/balance';
import type { PageServerLoad } from './$types';
import type { Expense } from '$lib/types';

export const load: PageServerLoad = async ({ params }) => {
  const { tripId } = params;

  let tripResult, membersResult, expensesResult;
  try {
    [tripResult, membersResult, expensesResult] = await Promise.all([
      supabase.from('trips').select().eq('id', tripId).single(),
      supabase
        .from('trip_users')
        .select('id, name, payment_ref, role, status, joined_at')
        .eq('trip_id', tripId)
        .neq('status', 'removed')
        .order('joined_at'),
      supabase
        .from('expenses')
        .select('*, payer:paid_by(id,name), participants:expense_participants(*, member:user_id(id,name)), items:expense_items(*, assignments:expense_item_assignments(user_id))')
        .eq('trip_id', tripId)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false })
    ]);
  } catch {
    throw error(503, 'No se pudo conectar con la base de datos. Verificá las credenciales de Supabase en .env');
  }

  const { data: trip, error: tripErr } = tripResult;
  const { data: members, error: memberErr } = membersResult;
  const { data: expenses, error: expErr } = expensesResult;

  if (tripErr || !trip) throw error(404, 'Viaje no encontrado');
  if (memberErr) throw error(500, memberErr.message);
  if (expErr) throw error(500, expErr.message);

  const activeMembers = (members ?? []).filter((m) => m.status === 'active');
  const pendingMembers = (members ?? []).filter((m) => m.status === 'pending');

  const balances = computeBalances(expenses as Expense[]);
  const transfers = optimizeTransfers(balances);

  const { data: settlements } = await supabase
    .from('settlements')
    .select('*, from:from_user(id,name), to:to_user(id,name,payment_ref)')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  return {
    trip,
    members: activeMembers,
    pendingMembers,
    expenses: expenses ?? [],
    balances,
    transfers,
    settlements: settlements ?? []
  };
};
