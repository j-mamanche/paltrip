import { json } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireAdmin, getMemberId } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// GET — admin: lista de solicitudes pendientes
export const GET: RequestHandler = async ({ params, request }) => {
  const { tripId } = params;
  await requireAdmin(tripId, getMemberId(request));

  const pending = await query(() =>
    supabase
      .from('trip_users')
      .select('id, name, payment_ref, role, joined_at, status')
      .eq('trip_id', tripId)
      .eq('status', 'pending')
      .order('joined_at')
  );

  return json(pending);
};
