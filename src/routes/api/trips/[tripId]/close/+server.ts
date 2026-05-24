import { json, error } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabase';
import { requireAdmin, getMemberId } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const { tripId } = params;
  await requireAdmin(tripId, getMemberId(request));

  const { error: err } = await supabase
    .from('trips').update({ status: 'closed' }).eq('id', tripId);

  if (err) throw error(500, err.message);
  return json({ status: 'closed' });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const { tripId } = params;
  await requireAdmin(tripId, getMemberId(request));

  const { error: err } = await supabase
    .from('trips').update({ status: 'active' }).eq('id', tripId);

  if (err) throw error(500, err.message);
  return json({ status: 'active' });
};
