import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Auto-refresh tokens before they expire
    autoRefreshToken: true,
    // Persist session in localStorage
    persistSession: true,
    // Detect session from URL (for OAuth redirects)
    detectSessionInUrl: true
  }
})

// Session timeout is now controlled by Supabase JWT expiry settings in the dashboard.
// Configure JWT expiry time in: Supabase Dashboard > Authentication > Settings > JWT expiry
// Recommended: Set to 1200 seconds (20 minutes) for the same behavior as before.
