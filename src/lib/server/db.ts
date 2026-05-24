import { error } from '@sveltejs/kit';
import { supabase } from './supabase';

const DB_ERROR = 'No se pudo conectar con la base de datos. Verificá las credenciales de Supabase en .env';

// Wraps a Supabase query and converts fetch failures into readable 503 errors.
export async function query<T>(
  fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>
): Promise<T> {
  let result: { data: T | null; error: { message: string } | null };
  try {
    result = await fn();
  } catch {
    throw error(503, DB_ERROR);
  }
  if (result.error) {
    const msg = result.error.message ?? '';
    const isNetworkError = msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError');
    throw error(isNetworkError ? 503 : 500, isNetworkError ? DB_ERROR : msg);
  }
  if (result.data === null) throw error(404, 'No encontrado');
  return result.data;
}

export { supabase };
