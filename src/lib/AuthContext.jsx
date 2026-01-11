import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { logAuthEvent, AuditAction } from '@/lib/auditLog';

const AuthContext = createContext();

// Constants for MFA
const DEVICE_TRUST_DAYS = 7;
const DEVICE_TOKEN_KEY = 'mfa_device_token';

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

      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);

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

      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);

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
      // SECURITY: Clear organization context to prevent data leakage on next login
      // Using sessionStorage (per-tab isolation)
      sessionStorage.removeItem('currentOrganizationId');
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
      // Still clear org context even if signOut fails
      sessionStorage.removeItem('currentOrganizationId');
      // Still redirect to login
      window.location.href = '/Login';
    }
  };

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
