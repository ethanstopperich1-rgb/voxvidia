import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env, createLogger } from '@voxvidia/shared';

const logger = createLogger('storage:supabase');

let supabase: SupabaseClient | null = null;

if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  logger.info('Supabase client initialized');
} else {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — storage disabled');
}

export { supabase };
