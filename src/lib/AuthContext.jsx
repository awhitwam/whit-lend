import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { logAuthEvent, AuditAction } from '@/lib/auditLog';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Check for existing session
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);
      setIsLoadingAuth(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkSession = async () => {
    try {
      setIsLoadingAuth(true);
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setIsAuthenticated(!!session?.user);
    } catch (error) {
      console.error('Session check failed:', error);
      setAuthError({
        type: 'session_error',
        message: error.message
      });
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

  const logout = async () => {
    try {
      const userEmail = user?.email;
      // SECURITY: Clear organization context to prevent data leakage on next login
      localStorage.removeItem('currentOrganizationId');
      await supabase.auth.signOut();
      // Log logout event
      logAuthEvent(AuditAction.LOGOUT, userEmail, true);
      setUser(null);
      setIsAuthenticated(false);
      // Redirect to login page
      window.location.href = '/Login';
    } catch (error) {
      console.error('Logout failed:', error);
      // Still clear org context even if signOut fails
      localStorage.removeItem('currentOrganizationId');
      // Still redirect to login
      window.location.href = '/Login';
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
      checkSession
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
