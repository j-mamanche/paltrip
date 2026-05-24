import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from '$env/static/private';

// Server-only client — uses service role key, bypasses RLS
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
