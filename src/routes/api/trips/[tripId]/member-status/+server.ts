import { json } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabase';
import { getMemberId } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
  const memberId = getMemberId(request);
  if (!memberId) return json({ status: null });

  const { data } = await supabase
    .from('trip_users')
    .select('status')
    .eq('id', memberId)
    .eq('trip_id', params.tripId)
    .maybeSingle();

  return json({ status: data?.status ?? null });
};
