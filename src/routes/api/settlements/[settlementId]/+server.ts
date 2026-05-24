import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireMember, getMemberId } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { status } = body;

  if (!['pending', 'paid'].includes(status)) throw error(400, 'Estado inválido');

  const { data: settlement } = await supabase
    .from('settlements')
    .select('trip_id')
    .eq('id', params.settlementId)
    .single();

  if (!settlement) throw error(404, 'Liquidación no encontrada');

  await requireMember(settlement.trip_id, getMemberId(request));

  const data = await query(() =>
    supabase
      .from('settlements')
      .update({ status })
      .eq('id', params.settlementId)
      .select('*, from:from_user(id,name), to:to_user(id,name,payment_ref)')
      .single()
  );

  return json(data);
};
