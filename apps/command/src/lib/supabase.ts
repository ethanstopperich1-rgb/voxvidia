import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client using service role key.
 * Used in Server Components and API routes.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Browser-side Supabase client using anon key.
 * Used in Client Components for real-time subscriptions.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, key);
}
