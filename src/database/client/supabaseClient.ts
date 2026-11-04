import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

/**
 * The single browser-side Supabase client.
 *
 * Never put a service_role key in the frontend. Privileged operations belong
 * in trusted server-side code such as Supabase Edge Functions.
 */
export const supabaseClient = createClient(supabaseUrl, supabasePublishableKey)
