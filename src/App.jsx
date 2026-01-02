import { useState, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { OrganizationProvider } from '@/lib/OrganizationContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import MFASetup from '@/pages/MFASetup';
import MFAVerify from '@/pages/MFAVerify';
import ResetPassword from '@/pages/ResetPassword';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// Set to false to disable MFA enforcement (for debugging or if Supabase plan doesn't support it)
// Disabled: MFA conflicts with password reset (AAL2 required to change password)
const MFA_ENFORCEMENT_ENABLED = false;

// MFA-aware wrapper that checks enrollment and verification status
const MFAProtectedApp = () => {
  const { isAuthenticated, checkMfaStatus, checkTrustedDevice, mfaEnrolled, mfaRequired } = useAuth();
  const location = useLocation();
  const [mfaChecked, setMfaChecked] = useState(false);
  const [mfaStatusResult, setMfaStatusResult] = useState({ enrolled: false, mfaRequired: false });
  const [deviceTrusted, setDeviceTrusted] = useState(false);

  useEffect(() => {
    const checkMfa = async () => {
      if (isAuthenticated) {
        try {
          // Add timeout to prevent infinite loading
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MFA check timeout')), 10000)
          );
          const status = await Promise.race([checkMfaStatus(), timeoutPromise]);
          setMfaStatusResult(status);

          // Also check if device is trusted
          if (status.mfaRequired) {
            try {
              const isTrusted = await checkTrustedDevice();
              console.log('[MFAProtectedApp] Device trusted:', isTrusted);
              setDeviceTrusted(isTrusted);
            } catch (trustError) {
              console.error('Trusted device check failed:', trustError);
              setDeviceTrusted(false);
            }
          }
        } catch (error) {
          console.error('MFA check failed:', error);
          // On error, assume MFA is required so user can still try to verify
          setMfaStatusResult({ enrolled: true, mfaRequired: true });
        }
      }
      setMfaChecked(true);
    };
    checkMfa();
  }, [isAuthenticated]);

  // Don't redirect while still checking MFA status
  if (!mfaChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Allow MFA pages through without additional checks
  if (location.pathname === '/mfa-setup' || location.pathname === '/mfa-verify') {
    return null; // Let the route render
  }

  // Skip MFA checks if enforcement is disabled
  if (!MFA_ENFORCEMENT_ENABLED) {
    return null;
  }

  // If user is authenticated but hasn't enrolled in MFA, redirect to setup
  if (isAuthenticated && !mfaStatusResult.enrolled) {
    return <Navigate to="/mfa-setup" replace />;
  }

  // If user is authenticated and enrolled but needs to verify MFA
  // Skip MFA verification if device is trusted
  if (isAuthenticated && mfaStatusResult.enrolled && mfaStatusResult.mfaRequired) {
    if (deviceTrusted) {
      console.log('[MFAProtectedApp] Device is trusted - skipping MFA verification');
      return null; // Allow through without MFA
    }
    return <Navigate to="/mfa-verify" replace />;
  }

  // User is fully authenticated with MFA
  return null;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authError, logout } = useAuth();
  const location = useLocation();

  // Check for password recovery token in URL hash FIRST, before anything else
  // This prevents the app from redirecting to login before Supabase can process the token
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const isRecoveryFlow = hashParams.get('type') === 'recovery';

  // Redirect to ResetPassword page if this is a recovery flow
  useEffect(() => {
    if (isRecoveryFlow && location.pathname !== '/ResetPassword') {
      // Preserve the hash when redirecting
      console.log('[App] Recovery flow detected, redirecting to ResetPassword');
      window.location.href = '/ResetPassword' + window.location.hash;
    }
  }, [isRecoveryFlow, location.pathname]);

  // If this is a recovery flow, show loading and let the redirect happen
  // The AuthContext will also fire PASSWORD_RECOVERY event which redirects to /ResetPassword
  if (isRecoveryFlow && location.pathname !== '/ResetPassword') {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Emergency logout via query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('force_logout') === 'true') {
      console.log('Force logout requested');
      localStorage.clear();
      sessionStorage.clear();
      logout().finally(() => {
        window.location.href = '/Login';
      });
    }
  }, [location.search]);

  // Show loading spinner while checking auth
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  // Public routes that don't require authentication
  const publicRoutes = ['/Login', '/AcceptInvitation', '/ResetPassword'];
  const isPublicRoute = publicRoutes.some(route => location.pathname.startsWith(route));

  // If not authenticated and not on a public route, redirect to Login
  if (!isAuthenticated && !isPublicRoute) {
    return <Navigate to="/Login" replace />;
  }

  // MFA routes need authentication but not full MFA verification yet
  const mfaRoutes = ['/mfa-setup', '/mfa-verify'];
  const isMfaRoute = mfaRoutes.includes(location.pathname);

  // Render the main app
  return (
    <Routes>
      {/* Password reset route - public, handles recovery tokens */}
      <Route path="/ResetPassword" element={<ResetPassword />} />

      {/* MFA routes - require auth but not MFA completion */}
      <Route path="/mfa-setup" element={<MFASetup />} />
      <Route path="/mfa-verify" element={<MFAVerify />} />

      {/* Protected routes - require auth AND MFA */}
      <Route path="/" element={
        <>
          <MFAProtectedApp />
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
          </LayoutWrapper>
        </>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <>
              <MFAProtectedApp />
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            </>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <OrganizationProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <NavigationTracker />
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <VisualEditAgent />
        </QueryClientProvider>
      </OrganizationProvider>
    </AuthProvider>
  )
}

export default App
