import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { logAuthEvent, AuditAction } from '@/lib/auditLog';

const AuthContext = createContext();

// Constants for MFA
const DEVICE_TRUST_DAYS = 7;
const DEVICE_TOKEN_KEY = 'mfa_device_token';

// Constants for inactivity timeout
const DEFAULT_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes default
const WARNING_BEFORE_TIMEOUT_MS = 2 * 60 * 1000; // Show warning 2 minutes before timeout
// Only track intentional user interactions (not passive mouse movement)
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
// sessionStorage key to detect browser restart (sessionStorage is cleared when browser closes)
const SESSION_ALIVE_KEY = 'whit_lend_session_alive';
// sessionStorage key to track if THIS tab initiated a logout (sessionStorage is per-tab)
const TAB_LOGOUT_KEY = 'whit_lend_tab_logout';

// Generate a secure device token
const generateDeviceToken = () => {
  return crypto.randomUUID() + '-' + crypto.randomUUID();
};

// Get device name from user agent
const getDeviceName = () => {
  const ua = navigator.userAgent;
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  // Detect browser
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';

  // Detect OS
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser} on ${os}`;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  // MFA state
  const [mfaFactors, setMfaFactors] = useState([]);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [currentFactorId, setCurrentFactorId] = useState(null);

  // Super admin state
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Session expiry tracking for timeout warning
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);

  // Activity-based inactivity timeout
  const lastActivityRef = useRef(Date.now());
  const inactivityTimerRef = useRef(null);
  const timeoutTriggeredRef = useRef(false); // Guard to prevent multiple timeout triggers
  const tabSessionIdRef = useRef(null); // Unique ID for this tab's session (for audit tracking)
  const wasAuthenticatedRef = useRef(false); // Track auth state transitions
  const [inactivityTimeoutMs, setInactivityTimeoutMs] = useState(DEFAULT_INACTIVITY_TIMEOUT_MS);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [timeoutSecondsRemaining, setTimeoutSecondsRemaining] = useState(0);

  // Check if user is a super admin - defined before useEffect to avoid hoisting issues
  const checkSuperAdminStatus = async (userId) => {
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Super admin check timeout')), 5000)
      );

      const queryPromise = supabase
        .from('user_profiles')
        .select('is_super_admin')
        .eq('id', userId)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        console.error('Error checking super admin status:', error);
        setIsSuperAdmin(false);
        return false;
      }

      const superAdminStatus = data?.is_super_admin || false;
      setIsSuperAdmin(superAdminStatus);
      return superAdminStatus;
    } catch (error) {
      console.error('Error checking super admin status:', error);
      setIsSuperAdmin(false);
      return false;
    }
  };

  useEffect(() => {
    console.log('[AuthContext] useEffect mounting - checking session');
    console.log('[AuthContext] Current URL:', window.location.href);
    console.log('[AuthContext] sessionStorage keys:', Object.keys(sessionStorage));
    console.log('[AuthContext] SESSION_ALIVE_KEY:', sessionStorage.getItem(SESSION_ALIVE_KEY));
    console.log('[AuthContext] TAB_LOGOUT_KEY:', sessionStorage.getItem(TAB_LOGOUT_KEY));

    // Check for existing session
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] Auth event:', event, 'session:', session ? 'exists' : 'null');

      // Handle password recovery event - redirect to reset password page
      if (event === 'PASSWORD_RECOVERY') {
        console.log('[AuthContext] Password recovery detected, redirecting to reset password page');
        // The session is valid for password reset, redirect to the reset page
        window.location.href = '/ResetPassword';
        return;
      }

      // Handle SIGNED_OUT event
      // IMPORTANT: supabase.auth.signOut() is GLOBAL - it fires SIGNED_OUT in ALL tabs.
      // We need to check if THIS tab initiated the logout to avoid logging out active tabs.
      if (event === 'SIGNED_OUT') {
        // Check if THIS tab initiated the logout (using sessionStorage which is per-tab)
        const thisTabLoggedOut = sessionStorage.getItem(TAB_LOGOUT_KEY) === 'true';

        if (thisTabLoggedOut) {
          // This tab initiated the logout - clear the flag and let the logout function handle redirect
          sessionStorage.removeItem(TAB_LOGOUT_KEY);
          console.log('[AuthContext] This tab initiated logout, letting logout() handle redirect');
          // Reset state but don't redirect (logout() handles that)
          setUser(null);
          setIsAuthenticated(false);
          setIsSuperAdmin(false);
          setSessionExpiresAt(null);
          return;
        }

        // Another tab logged out OR the session was revoked server-side
        // For truly autonomous tabs, we IGNORE this event if we were active
        // The user can continue working in this tab until their own inactivity timeout
        console.log('[AuthContext] SIGNED_OUT event from another tab/source - ignoring for tab autonomy');
        // Don't clear state, don't redirect - this tab remains functional
        // The inactivity timer will handle timeout for this tab independently
        return;
      }

      // Only update state if values actually changed to avoid unnecessary re-renders
      // SIGNED_IN events fire frequently (on tab focus, token refresh, etc.)
      const newUser = session?.user ?? null;
      const newIsAuthenticated = !!session?.user;

      setUser(prevUser => {
        if (prevUser?.id === newUser?.id) {
          console.log('[AuthContext] User unchanged, skipping state update');
          return prevUser; // No change
        }
        console.log('[AuthContext] User changed, updating state');
        return newUser;
      });
      setIsAuthenticated(prev => {
        if (prev === newIsAuthenticated) {
          console.log('[AuthContext] isAuthenticated unchanged, skipping state update');
          return prev; // No change
        }
        console.log('[AuthContext] isAuthenticated changed to:', newIsAuthenticated);
        return newIsAuthenticated;
      });

      // Track session expiry time for timeout warning
      if (session?.expires_at) {
        const newExpiresAt = session.expires_at * 1000;
        setSessionExpiresAt(prev => prev === newExpiresAt ? prev : newExpiresAt);
      } else {
        setSessionExpiresAt(prev => prev === null ? prev : null);
      }

      // Check super admin status on auth change (with internal timeout protection)
      if (session?.user) {
        // Don't await - let it complete in background to avoid blocking auth state
        checkSuperAdminStatus(session.user.id).catch(err => {
          console.error('Failed to check super admin status:', err);
        });
      } else {
        setIsSuperAdmin(false);
      }

      setIsLoadingAuth(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkSession = async () => {
    console.log('[AuthContext] checkSession() called');
    try {
      setIsLoadingAuth(true);

      // Add timeout to prevent infinite loading if SDK hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), 10000)
      );

      const sessionPromise = supabase.auth.getSession();
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);

      console.log('[AuthContext] checkSession result:', session ? `user: ${session.user?.email}` : 'no session');

      // NOTE: We no longer try to detect "browser was closed" via sessionStorage.
      // Browser tab discarding (Memory Saver feature) clears sessionStorage but keeps
      // the Supabase session, causing false-positive logouts when the user returns.
      // Instead, we rely on the inactivity timeout to handle session expiration.

      // Use functional updates to preserve object references when user hasn't changed
      // This prevents unnecessary re-renders in dependent contexts (like OrganizationContext)
      const newUser = session?.user ?? null;
      const newIsAuthenticated = !!session?.user;
      console.log('[AuthContext] Setting isAuthenticated to:', newIsAuthenticated);

      setUser(prevUser => {
        if (prevUser?.id === newUser?.id) {
          console.log('[AuthContext] User unchanged in checkSession, preserving reference');
          return prevUser; // Keep same reference to avoid triggering dependent useEffects
        }
        console.log('[AuthContext] User changed in checkSession, updating state');
        return newUser;
      });
      setIsAuthenticated(prev => {
        if (prev === newIsAuthenticated) {
          return prev; // No change
        }
        return newIsAuthenticated;
      });

      // Mark session as alive for this tab (used by inactivity timer)
      if (session?.user) {
        sessionStorage.setItem(SESSION_ALIVE_KEY, 'true');
      }

      // Track session expiry time for timeout warning
      if (session?.expires_at) {
        setSessionExpiresAt(session.expires_at * 1000); // Convert to milliseconds
      } else {
        setSessionExpiresAt(null);
      }

      // Check super admin status if user is authenticated
      if (session?.user) {
        await checkSuperAdminStatus(session.user.id);
      } else {
        setIsSuperAdmin(false);
      }
    } catch (error) {
      console.error('Session check failed:', error);

      // If session check times out, clear potentially corrupted session data
      if (error.message === 'Session check timeout') {
        console.log('Session check timed out, clearing session data...');
        const storageKey = `sb-${import.meta.env.VITE_SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`;
        localStorage.removeItem(storageKey);
        setUser(null);
        setIsAuthenticated(false);
        setIsSuperAdmin(false);
      } else {
        setAuthError({
          type: 'session_error',
          message: error.message
        });
      }
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const login = async (email, password) => {
    try {
      setAuthError(null);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        setAuthError({
          type: 'login_error',
          message: error.message
        });
        // Log failed login attempt
        logAuthEvent(AuditAction.LOGIN_FAILED, email, false, { reason: error.message });
        return { error };
      }

      setUser(data.user);
      setIsAuthenticated(true);
      // Mark session as alive (cleared when browser closes)
      sessionStorage.setItem(SESSION_ALIVE_KEY, 'true');
      // Generate new session ID for this login
      tabSessionIdRef.current = crypto.randomUUID();
      // Initialize activity timestamp for this tab
      lastActivityRef.current = Date.now();
      console.log('[AuthContext] Login successful, session_id:', tabSessionIdRef.current);
      // Log successful login with session ID
      logAuthEvent(AuditAction.LOGIN, email, true, { session_id: tabSessionIdRef.current });
      return { data };
    } catch (error) {
      setAuthError({
        type: 'login_error',
        message: error.message
      });
      return { error };
    }
  };

  const signup = async (email, password) => {
    try {
      setAuthError(null);
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        setAuthError({
          type: 'signup_error',
          message: error.message
        });
        return { error };
      }

      return { data };
    } catch (error) {
      setAuthError({
        type: 'signup_error',
        message: error.message
      });
      return { error };
    }
  };

  // Request password reset email
  const resetPasswordForEmail = async (email) => {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/ResetPassword`
      });

      if (error) {
        logAuthEvent(AuditAction.LOGIN_FAILED, email, false, {
          reason: 'Password reset request failed: ' + error.message
        });
        return { error };
      }

      // Log the password reset request
      logAuthEvent(AuditAction.LOGIN, email, true, {
        action: 'password_reset_requested'
      });

      return { data };
    } catch (error) {
      return { error };
    }
  };

  const logout = async () => {
    try {
      // Capture user info BEFORE signOut - needed for audit logging
      const userEmail = user?.email;
      const userId = user?.id;
      // Capture org ID BEFORE clearing - needed for audit logging
      const currentOrgId = sessionStorage.getItem('currentOrganizationId');

      // CRITICAL: Log logout event BEFORE signOut while session is still valid
      // RLS policies require a valid session for INSERT
      console.log('[AuthContext] Logout, session_id:', tabSessionIdRef.current);
      try {
        await logAuthEvent(AuditAction.LOGOUT, userEmail, true, {
          organization_id: currentOrgId,
          user_id: userId,
          session_id: tabSessionIdRef.current
        });
      } catch (auditError) {
        console.error('[AuthContext] Logout audit failed:', auditError);
      }

      // Mark THIS tab as initiating logout (sessionStorage is per-tab)
      sessionStorage.setItem(TAB_LOGOUT_KEY, 'true');
      // Clear organization context and session markers
      sessionStorage.removeItem('currentOrganizationId');
      sessionStorage.removeItem(SESSION_ALIVE_KEY);

      // Sign out from Supabase - this will trigger SIGNED_OUT event
      await supabase.auth.signOut();

      // Reset state
      setUser(null);
      setIsAuthenticated(false);
      setMfaFactors([]);
      setMfaRequired(false);
      setMfaEnrolled(false);
      setCurrentFactorId(null);
      setIsSuperAdmin(false);

      // Redirect to login page
      window.location.href = '/Login';
    } catch (error) {
      console.error('Logout failed:', error);
      sessionStorage.removeItem('currentOrganizationId');
      sessionStorage.removeItem(SESSION_ALIVE_KEY);
      sessionStorage.removeItem(TAB_LOGOUT_KEY);
      window.location.href = '/Login';
    }
  };

  // Refresh the session to extend the timeout
  const refreshSession = async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;

      // Update session expiry time
      if (data?.session?.expires_at) {
        setSessionExpiresAt(data.session.expires_at * 1000); // Convert to milliseconds
      }

      return { data, error: null };
    } catch (error) {
      console.error('Failed to refresh session:', error);
      return { data: null, error };
    }
  };

  // Reset activity timestamp on user interaction
  // Each tab tracks its own activity independently (no localStorage sync)
  const resetActivityTimer = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    // Hide warning if showing (user became active)
    setShowTimeoutWarning(false);
  }, []);

  // Get last activity time (for SessionTimeoutWarning)
  const getLastActivityTime = useCallback(() => {
    return lastActivityRef.current;
  }, []);

  // Load session timeout setting from app_settings
  const loadSessionTimeoutSetting = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'session_timeout_minutes')
        .single();

      if (!error && data?.value) {
        const minutes = parseInt(data.value, 10);
        if (minutes >= 5 && minutes <= 60) {
          setInactivityTimeoutMs(minutes * 60 * 1000);
          console.log(`[AuthContext] Session timeout set to ${minutes} minutes`);
        }
      }
    } catch (err) {
      console.error('Error loading session timeout setting:', err);
    }
  }, []);

  // Set up activity tracking when authenticated
  useEffect(() => {
    console.log('[AuthContext] Activity tracking useEffect - isAuthenticated:', isAuthenticated);
    if (!isAuthenticated) {
      // Clear timer when not authenticated
      console.log('[AuthContext] Not authenticated, clearing inactivity timer');
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    // Load timeout setting
    loadSessionTimeoutSetting();

    // Initialize activity timestamp for this tab to now
    // Each tab tracks its own activity independently
    console.log('[AuthContext] Authenticated, initializing activity timer');
    lastActivityRef.current = Date.now();

    // Only reset timeout guard on fresh login (was unauthenticated, now authenticated)
    // Don't reset when useEffect re-runs due to other dependency changes (like inactivityTimeoutMs)
    if (!wasAuthenticatedRef.current && isAuthenticated) {
      timeoutTriggeredRef.current = false;
      // Only generate session ID if not already set (login() may have already set it)
      if (!tabSessionIdRef.current) {
        tabSessionIdRef.current = crypto.randomUUID();
        console.log('[AuthContext] Generated new session_id (session restore):', tabSessionIdRef.current);
      } else {
        console.log('[AuthContext] Preserving existing session_id from login:', tabSessionIdRef.current);
      }
    }
    wasAuthenticatedRef.current = isAuthenticated;

    // Listen for user activity in this tab
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, resetActivityTimer, { passive: true });
    });

    // Check inactivity periodically - use 1 second interval for smooth countdown
    const checkInactivity = () => {
      const elapsed = Date.now() - lastActivityRef.current;
      const timeRemaining = inactivityTimeoutMs - elapsed;

      if (timeRemaining <= 0) {
        // Guard: Only trigger timeout once to prevent multiple audit logs
        if (timeoutTriggeredRef.current) {
          return;
        }
        timeoutTriggeredRef.current = true;

        // This tab has been inactive too long - redirect to login
        // Clear the interval to prevent any further checks
        if (inactivityTimerRef.current) {
          clearInterval(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
        }
        setShowTimeoutWarning(false);

        // Capture org ID and user ID BEFORE clearing - needed for audit logging
        const currentOrgId = sessionStorage.getItem('currentOrganizationId');
        const currentUserId = user?.id;

        // Clear this tab's org context (sessionStorage is per-tab)
        sessionStorage.removeItem('currentOrganizationId');
        sessionStorage.removeItem(SESSION_ALIVE_KEY);

        // Log session timeout event, then redirect after audit completes
        console.log('[AuthContext] Session timeout, session_id:', tabSessionIdRef.current);
        logAuthEvent(AuditAction.SESSION_TIMEOUT, user?.email, true, {
          organization_id: currentOrgId,
          user_id: currentUserId,
          session_id: tabSessionIdRef.current,
          reason: 'inactivity',
          timeout_ms: inactivityTimeoutMs
        }).finally(() => {
          // Redirect to login without signing out of Supabase
          window.location.href = '/Login?session_expired=true';
        });
      } else if (timeRemaining <= WARNING_BEFORE_TIMEOUT_MS) {
        // Show warning with countdown
        setShowTimeoutWarning(true);
        setTimeoutSecondsRemaining(Math.ceil(timeRemaining / 1000));
      } else {
        // Not in warning zone, hide warning
        setShowTimeoutWarning(false);
      }
    };

    // Use 1 second interval for smooth countdown display
    inactivityTimerRef.current = setInterval(checkInactivity, 1000);
    // Also check immediately
    checkInactivity();

    return () => {
      // Cleanup
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, resetActivityTimer);
      });
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [isAuthenticated, inactivityTimeoutMs, resetActivityTimer, loadSessionTimeoutSetting]);

  // Check MFA enrollment status and AAL level
  const checkMfaStatus = async () => {
    try {
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];
      setMfaFactors(verifiedFactors);
      setMfaEnrolled(verifiedFactors.length > 0);

      if (verifiedFactors.length > 0) {
        setCurrentFactorId(verifiedFactors[0].id);
      }

      // Check AAL level
      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;

      // If user has MFA enrolled but current AAL is aal1, they need to verify
      if (aalData.nextLevel === 'aal2' && aalData.currentLevel === 'aal1') {
        setMfaRequired(true);
      } else {
        setMfaRequired(false);
      }

      return { enrolled: verifiedFactors.length > 0, mfaRequired: aalData.nextLevel === 'aal2' && aalData.currentLevel === 'aal1' };
    } catch (error) {
      console.error('Error checking MFA status:', error);
      return { enrolled: false, mfaRequired: false };
    }
  };

  // Enroll in MFA - returns QR code data
  const enrollMfa = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: getDeviceName()
      });

      if (error) throw error;

      return {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret
      };
    } catch (error) {
      console.error('MFA enrollment failed:', error);
      throw error;
    }
  };

  // Verify MFA code during enrollment or login
  const verifyMfa = async (code, factorId = null) => {
    try {
      let targetFactorId = factorId || currentFactorId;

      // If no factor ID available, fetch it from Supabase
      if (!targetFactorId) {
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;

        const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];
        if (verifiedFactors.length === 0) {
          throw new Error('No MFA factors enrolled. Please set up MFA first.');
        }
        targetFactorId = verifiedFactors[0].id;
        setCurrentFactorId(targetFactorId);
      }

      // Create a challenge
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: targetFactorId
      });

      if (challengeError) throw challengeError;

      // Verify the code using SDK
      const { data, error } = await supabase.auth.mfa.verify({
        factorId: targetFactorId,
        challengeId: challengeData.id,
        code: code
      });

      if (error) throw error;

      // Log successful MFA verification
      logAuthEvent(AuditAction.LOGIN, user?.email, true, { mfa: true });

      // Update MFA state
      setMfaRequired(false);

      // Update MFA status in background
      checkMfaStatus().catch(err => console.error('Error updating MFA status:', err));

      return { success: true, data };
    } catch (error) {
      console.error('MFA verification failed:', error);
      logAuthEvent(AuditAction.LOGIN_FAILED, user?.email, false, { mfa: true, reason: error.message });
      throw error;
    }
  };

  // Unenroll from MFA
  const unenrollMfa = async (factorId) => {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;

      await checkMfaStatus();
      return { success: true };
    } catch (error) {
      console.error('MFA unenrollment failed:', error);
      throw error;
    }
  };

  // Check if current device is trusted
  const checkTrustedDevice = async () => {
    try {
      const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
      if (!deviceToken) return false;

      const { data, error } = await supabase
        .from('trusted_devices')
        .select('*')
        .eq('device_token', deviceToken)
        .gt('trusted_until', new Date().toISOString())
        .single();

      if (error || !data) {
        // Token not found or expired, remove from localStorage
        localStorage.removeItem(DEVICE_TOKEN_KEY);
        return false;
      }

      // Update last_used timestamp
      await supabase
        .from('trusted_devices')
        .update({ last_used: new Date().toISOString() })
        .eq('id', data.id);

      return true;
    } catch (error) {
      console.error('Error checking trusted device:', error);
      return false;
    }
  };

  // Trust the current device for 7 days
  const trustDevice = async () => {
    try {
      const deviceToken = generateDeviceToken();
      const trustedUntil = new Date();
      trustedUntil.setDate(trustedUntil.getDate() + DEVICE_TRUST_DAYS);

      const { error } = await supabase
        .from('trusted_devices')
        .insert({
          user_id: user.id,
          device_token: deviceToken,
          device_name: getDeviceName(),
          user_agent: navigator.userAgent,
          trusted_until: trustedUntil.toISOString()
        });

      if (error) throw error;

      // Store token in localStorage
      localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
      return { success: true };
    } catch (error) {
      console.error('Error trusting device:', error);
      throw error;
    }
  };

  // Remove device trust (logout from this device's trust)
  const untrustDevice = async () => {
    try {
      const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
      if (deviceToken) {
        await supabase
          .from('trusted_devices')
          .delete()
          .eq('device_token', deviceToken);
        localStorage.removeItem(DEVICE_TOKEN_KEY);
      }
      return { success: true };
    } catch (error) {
      console.error('Error untrusting device:', error);
      throw error;
    }
  };

  // Get all trusted devices for current user
  const getTrustedDevices = async () => {
    try {
      const { data, error } = await supabase
        .from('trusted_devices')
        .select('*')
        .order('last_used', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error getting trusted devices:', error);
      return [];
    }
  };

  // Remove a specific trusted device
  const removeTrustedDevice = async (deviceId) => {
    try {
      const { error } = await supabase
        .from('trusted_devices')
        .delete()
        .eq('id', deviceId);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error removing trusted device:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      login,
      signup,
      logout,
      resetPasswordForEmail,
      checkSession,
      // Session timeout (JWT-based, kept for backwards compatibility)
      sessionExpiresAt,
      refreshSession,
      // Activity-based inactivity timeout
      inactivityTimeoutMs,
      setInactivityTimeoutMs,
      getLastActivityTime,
      resetActivityTimer,
      showTimeoutWarning,
      timeoutSecondsRemaining,
      // MFA methods
      mfaFactors,
      mfaRequired,
      mfaEnrolled,
      currentFactorId,
      checkMfaStatus,
      enrollMfa,
      verifyMfa,
      unenrollMfa,
      // Device trust methods
      checkTrustedDevice,
      trustDevice,
      untrustDevice,
      getTrustedDevices,
      removeTrustedDevice,
      // Super admin
      isSuperAdmin,
      checkSuperAdminStatus
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
