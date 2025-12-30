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

// Session timeout: 2 hours of inactivity
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
let lastActivityTime = Date.now();
let activityCheckInterval = null;

// Track user activity
const updateActivity = () => {
  lastActivityTime = Date.now();
};

// Check for session timeout
const checkSessionTimeout = async () => {
  const timeSinceActivity = Date.now() - lastActivityTime;

  if (timeSinceActivity > SESSION_TIMEOUT_MS) {
    // User has been inactive for too long - sign them out
    console.log('Session timed out due to inactivity');
    await supabase.auth.signOut();
    window.location.href = '/Login?timeout=true';
  }
};

// Start activity monitoring when the module loads
if (typeof window !== 'undefined') {
  // Listen for user activity
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
    window.addEventListener(event, updateActivity, { passive: true });
  });

  // Check for timeout every minute
  activityCheckInterval = setInterval(checkSessionTimeout, 60 * 1000);

  // Also check when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkSessionTimeout();
    }
  });
}