import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { logAuthEvent, AuditAction } from '@/lib/auditLog';

const AuthContext = createContext();

// Constants for MFA
const DEVICE_TRUST_DAYS = 7;
const DEVICE_TOKEN_KEY = 'mfa_device_token';

// Constants for inactivity timeout
const DEFAULT_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes default
const ACTIVITY_CHECK_INTERVAL_MS = 10 * 1000; // Check every 10 seconds
// Only track intentional user interactions (not passive mouse movement)
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
// localStorage key for persisting activity timestamp across browser restarts
const LAST_ACTIVITY_KEY = 'whit_lend_last_activity';
// sessionStorage key to detect browser restart (sessionStorage is cleared when browser closes)
const SESSION_ALIVE_KEY = 'whit_lend_session_alive';

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
  const isManualLogoutRef = useRef(false);

  // Activity-based inactivity timeout
  const lastActivityRef = useRef(Date.now());
  const inactivityTimerRef = useRef(null);
  const [inactivityTimeoutMs, setInactivityTimeoutMs] = useState(DEFAULT_INACTIVITY_TIMEOUT_MS);

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
    // Check for existing session
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] Auth event:', event);

      // Handle password recovery event - redirect to reset password page
      if (event === 'PASSWORD_RECOVERY') {
        console.log('[AuthContext] Password recovery detected, redirecting to reset password page');
        // The session is valid for password reset, redirect to the reset page
        window.location.href = '/ResetPassword';
        return;
      }

      // Handle session expiration (inactivity timeout)
      if (event === 'SIGNED_OUT') {
        // Only redirect if we were previously authenticated AND it wasn't a manual logout
        // Manual logout already handles its own redirect
        if (isAuthenticated && !isManualLogoutRef.current) {
          console.log('[AuthContext] Session expired due to inactivity, redirecting to login');
          sessionStorage.removeItem('currentOrganizationId');
          setUser(null);
          setIsAuthenticated(false);
          setIsSuperAdmin(false);
          setSessionExpiresAt(null);
          window.location.href = '/Login?session_expired=true';
          return;
        }
        // Reset the manual logout flag
        isManualLogoutRef.current = false;
      }

      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);

      // Track session expiry time for timeout warning
      if (session?.expires_at) {
        setSessionExpiresAt(session.expires_at * 1000); // Convert to milliseconds
      } else {
        setSessionExpiresAt(null);
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
    try {
      setIsLoadingAuth(true);

      // Add timeout to prevent infinite loading if SDK hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session check timeout')), 10000)
      );

      const sessionPromise = supabase.auth.getSession();
      const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);

      // Check if browser was closed and reopened (session should end on browser close)
      if (session?.user) {
        // Skip browser-close detection for authentication callback routes
        // These routes handle their own session/token processing (e.g., invite links, password reset)
        const authCallbackRoutes = ['/AcceptInvitation', '/ResetPassword'];
        const currentPath = window.location.pathname;
        const isAuthCallback = authCallbackRoutes.some(route => currentPath.startsWith(route));

        if (!isAuthCallback) {
          const sessionAlive = sessionStorage.getItem(SESSION_ALIVE_KEY);

          if (!sessionAlive) {
            // sessionStorage is empty = browser was closed and reopened
            // This means the user closed the browser, so we should log them out
            console.log('[AuthContext] Browser was closed - ending session');
            localStorage.removeItem(LAST_ACTIVITY_KEY);
            sessionStorage.removeItem('currentOrganizationId');
            await supabase.auth.signOut();
            setIsLoadingAuth(false);
            window.location.href = '/Login?session_expired=true';
            return;
          }

          // Browser wasn't closed, check for inactivity timeout (e.g., page refresh after long idle)
          const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
          if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const elapsed = Date.now() - lastActivityTime;

            // Load timeout setting (or use default)
            let timeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS;
            try {
              const { data: settingsData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'session_timeout_minutes')
                .single();
              if (settingsData?.value) {
                const minutes = parseInt(settingsData.value, 10);
                if (minutes >= 5 && minutes <= 60) {
                  timeoutMs = minutes * 60 * 1000;
                }
              }
            } catch (e) {
              // Use default if fetch fails
            }

            if (elapsed >= timeoutMs) {
              // Session expired due to inactivity
              console.log('[AuthContext] Session expired due to inactivity');
              localStorage.removeItem(LAST_ACTIVITY_KEY);
              sessionStorage.removeItem('currentOrganizationId');
              sessionStorage.removeItem(SESSION_ALIVE_KEY);
              await supabase.auth.signOut();
              setIsLoadingAuth(false);
              window.location.href = '/Login?session_expired=true';
              return;
            }
          }
        } else {
          // For auth callbacks, set the session alive marker since user is actively authenticating
          console.log('[AuthContext] Auth callback route detected, skipping browser-close detection');
          sessionStorage.setItem(SESSION_ALIVE_KEY, 'true');
        }
      }

      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);

      // Mark session as alive if user is authenticated (for page refresh)
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
      // Log successful login
      logAuthEvent(AuditAction.LOGIN, email, true);
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
      const userEmail = user?.email;
      // Mark as manual logout so onAuthStateChange doesn't show "session expired" message
      isManualLogoutRef.current = true;
      // SECURITY: Clear organization context to prevent data leakage on next login
      // Using sessionStorage (per-tab isolation)
      sessionStorage.removeItem('currentOrganizationId');
      // Clear session markers
      sessionStorage.removeItem(SESSION_ALIVE_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      await supabase.auth.signOut();
      // Log logout event
      logAuthEvent(AuditAction.LOGOUT, userEmail, true);
      setUser(null);
      setIsAuthenticated(false);
      // Reset MFA state
      setMfaFactors([]);
      setMfaRequired(false);
      setMfaEnrolled(false);
      setCurrentFactorId(null);
      // Reset super admin state
      setIsSuperAdmin(false);
      // Redirect to login page
      window.location.href = '/Login';
    } catch (error) {
      console.error('Logout failed:', error);
      // Still clear org context and session markers even if signOut fails
      sessionStorage.removeItem('currentOrganizationId');
      sessionStorage.removeItem(SESSION_ALIVE_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      // Still redirect to login
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
  const resetActivityTimer = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    // Persist to localStorage for cross-session validation
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    } catch (e) {
      // Ignore localStorage errors (e.g., private browsing)
    }
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
    if (!isAuthenticated) {
      // Clear timer when not authenticated
      if (inactivityTimerRef.current) {
        clearInterval(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    // Load timeout setting
    loadSessionTimeoutSetting();

    // Initialize activity timestamp from localStorage or set to now
    const savedActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (savedActivity) {
      lastActivityRef.current = parseInt(savedActivity, 10);
    } else {
      const now = Date.now();
      lastActivityRef.current = now;
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
      } catch (e) {
        // Ignore localStorage errors
      }
    }

    // Listen for user activity
    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, resetActivityTimer, { passive: true });
    });

    // Check inactivity periodically
    const checkInactivity = () => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= inactivityTimeoutMs) {
        console.log('[AuthContext] User inactive for too long, signing out');
        // Clear the interval before logout to prevent multiple calls
        if (inactivityTimerRef.current) {
          clearInterval(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
        }
        // Treat as session timeout (not manual logout)
        isManualLogoutRef.current = false;
        // Clear org context
        sessionStorage.removeItem('currentOrganizationId');
        // Sign out and redirect
        supabase.auth.signOut().then(() => {
          window.location.href = '/Login?session_expired=true';
        });
      }
    };

    inactivityTimerRef.current = setInterval(checkInactivity, ACTIVITY_CHECK_INTERVAL_MS);

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
