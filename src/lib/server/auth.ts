import { error } from '@sveltejs/kit';
import { supabase } from './supabase';
import type { TripUser } from '$lib/types';

export function getMemberId(request: Request): string | null {
  return request.headers.get('x-member-id');
}

async function fetchMember(tripId: string, memberId: string): Promise<TripUser | null> {
  const { data } = await supabase
    .from('trip_users')
    .select('*')
    .eq('id', memberId)
    .eq('trip_id', tripId)
    .eq('status', 'active')
    .single();
  return data as TripUser | null;
}

export async function requireMember(tripId: string, memberId: string | null | undefined): Promise<TripUser> {
  if (!memberId) throw error(401, 'Identificación requerida');
  const member = await fetchMember(tripId, memberId);
  if (!member) throw error(401, 'No sos miembro activo de este viaje');
  return member;
}

export async function requireAdmin(tripId: string, memberId: string | null | undefined): Promise<TripUser> {
  const member = await requireMember(tripId, memberId);
  if (member.role !== 'admin') throw error(403, 'Solo los admins pueden hacer esto');
  return member;
}
