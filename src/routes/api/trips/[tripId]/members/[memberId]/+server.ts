import { json, error } from '@sveltejs/kit';
import { query, supabase } from '$lib/server/db';
import { requireAdmin, requireMember, getMemberId } from '$lib/server/auth';
import { validateText, validateOptionalText } from '$lib/server/validate';
import type { RequestHandler } from './$types';

// PATCH — self-edit (name/payment_ref) o admin (status/role)
export const PATCH: RequestHandler = async ({ params, request }) => {
  const { tripId, memberId } = params;
  const callerId = getMemberId(request);

  const body = await request.json();

  // Self-edit: el miembro actualiza su propio nombre y/o billetera
  if (callerId === memberId && (body.name !== undefined || 'payment_ref' in body)) {
    await requireMember(tripId, callerId);
    const updates: Record<string, string | null> = {};
    if (body.name?.trim()) updates.name = validateText(body.name, 'Nombre', 100);
    if ('payment_ref' in body) updates.payment_ref = validateOptionalText(body.payment_ref, 200);
    const member = await query(() =>
      supabase.from('trip_users').update(updates).eq('id', memberId).eq('trip_id', tripId).select().single()
    );
    return json(member);
  }

  await requireAdmin(tripId, callerId);

  if (body.status === 'active') {
    // Aprobar solicitud pendiente
    const member = await query(() =>
      supabase
        .from('trip_users')
        .update({ status: 'active' })
        .eq('id', memberId)
        .eq('trip_id', tripId)
        .eq('status', 'pending')
        .select()
        .single()
    );
    return json(member);
  }

  if (body.role === 'admin' || body.role === 'member') {
    // Cambiar rol
    if (memberId === callerId && body.role === 'member') {
      throw error(400, 'No podés quitarte el rol de admin a vos mismo');
    }
    const member = await query(() =>
      supabase
        .from('trip_users')
        .update({ role: body.role })
        .eq('id', memberId)
        .eq('trip_id', tripId)
        .select()
        .single()
    );
    return json(member);
  }

  throw error(400, 'Acción inválida');
};

// DELETE — admin elimina un miembro, o el miembro se elimina a sí mismo
export const DELETE: RequestHandler = async ({ params, request }) => {
  const { tripId, memberId } = params;
  const callerId = getMemberId(request);

  // Tiene que ser admin o el mismo usuario
  if (callerId !== memberId) {
    await requireAdmin(tripId, callerId);
  } else {
    await requireMember(tripId, callerId);
  }

  // Si la solicitud está pendiente → borrar directamente (nunca tuvo datos financieros)
  const { data: target } = await supabase
    .from('trip_users')
    .select('id, status')
    .eq('id', memberId)
    .eq('trip_id', tripId)
    .single();

  if (!target) throw error(404, 'Miembro no encontrado');

  if (target.status === 'pending') {
    await supabase.from('trip_users').delete().eq('id', memberId);
    return new Response(null, { status: 204 });
  }

  // Verificar si tiene registros financieros
  const [{ count: asPayor }, { count: asParticipant }] = await Promise.all([
    supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('paid_by', memberId),
    supabase.from('expense_participants').select('id', { count: 'exact', head: true }).eq('user_id', memberId)
  ]);

  if ((asPayor ?? 0) > 0 || (asParticipant ?? 0) > 0) {
    // Anonimizar: preservar datos financieros, eliminar datos personales
    await query(() =>
      supabase
        .from('trip_users')
        .update({ name: 'Usuario eliminado', payment_ref: null, status: 'removed' })
        .eq('id', memberId)
        .select()
        .single()
    );
  } else {
    await supabase.from('trip_users').delete().eq('id', memberId);
  }

  return new Response(null, { status: 204 });
};
