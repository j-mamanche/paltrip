import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const { name, currency, userName, paymentRef } = await request.json();

  if (!name?.trim() || !userName?.trim()) throw error(400, 'Faltan campos requeridos');

  const trip = await query(() =>
    supabase.from('trips').insert({ name: name.trim(), currency: currency ?? 'COP' }).select().single()
  );

  const member = await query(() =>
    supabase.from('trip_users').insert({
      trip_id: trip.id,
      name: userName.trim(),
      payment_ref: paymentRef?.trim() || null,
      role: 'admin'
    }).select().single()
  );

  return json({ trip, member }, { status: 201 });
};
