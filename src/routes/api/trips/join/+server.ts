import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { validateText, validateOptionalText } from '$lib/server/validate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { access_token, name, paymentRef } = body;

  if (!access_token?.trim()) throw error(400, 'Código de acceso requerido');

  const validName = validateText(name, 'Nombre', 100);
  const validPaymentRef = validateOptionalText(paymentRef, 200);

  const trip = await query(() =>
    supabase.from('trips').select().eq('access_token', access_token.trim()).single()
  );

  const member = await query(() =>
    supabase.from('trip_users').insert({
      trip_id: trip.id,
      name: validName,
      payment_ref: validPaymentRef,
      role: 'member',
      status: 'pending'   // espera aprobación del admin
    }).select().single()
  );

  return json({ trip, member }, { status: 201 });
};
