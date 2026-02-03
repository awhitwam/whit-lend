import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { isPasswordValid, getPasswordError } from '@/lib/passwordValidation';
import { PasswordStrengthIndicator } from '@/components/auth/PasswordStrengthIndicator';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, ready, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let authSubscription = null;

    const checkRecoverySession = async () => {
      try {
        // Check URL hash for error parameters first
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const urlError = hashParams.get('error');
        const errorDescription = hashParams.get('error_description');

        if (urlError) {
          if (isMounted) {
            setErrorMessage(errorDescription || 'The password reset link is invalid or has expired.');
            setStatus('error');
          }
          return;
        }

        // Check if there's a recovery token in the URL
        const accessToken = hashParams.get('access_token');
        const tokenType = hashParams.get('type');
        const hasRecoveryToken = accessToken && tokenType === 'recovery';

        // Set up auth state listener FIRST
        // This will catch the session when Supabase processes the recovery token
        const sessionPromise = new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve(null);
          }, 10000); // 10 second timeout

          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'TOKEN_REFRESHED') {
              clearTimeout(timeoutId);
              resolve(session);
            }
          });

          authSubscription = subscription;

          // Also check immediately in case session is already there
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
              clearTimeout(timeoutId);
              resolve(session);
            }
          });
        });

        // Wait for session (either from listener or immediate check)
        const session = await sessionPromise;

        if (!isMounted) return;

        if (session) {
          // Mark session as alive for this tab (prevents browser restart detection from signing us out)
          sessionStorage.setItem('whit_lend_session_alive', 'true');
          setStatus('ready');
        } else {
          setErrorMessage('Unable to verify your password reset link. It may have expired or already been used. Please request a new one.');
          setStatus('error');
        }

      } catch (error) {
        console.error('Error checking recovery session:', error);
        if (isMounted) {
          setErrorMessage('An unexpected error occurred. Please try again.');
          setStatus('error');
        }
      }
    };

    checkRecoverySession();

    return () => {
      isMounted = false;
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');

    // Validate password using shared validation
    if (!isPasswordValid(password)) {
      setPasswordError(getPasswordError(password));
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      // Re-verify session before attempting password update
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setPasswordError('Your session has expired. Please request a new password reset link.');
        setStatus('error');
        setErrorMessage('Your session has expired. Please request a new password reset link.');
        setIsSubmitting(false);
        return;
      }

      // Try to call edge function to unenroll MFA using admin API
      // This bypasses the AAL2 requirement that blocks password changes when MFA is enrolled
      try {
        await supabase.functions.invoke('unenroll-mfa');
      } catch (mfaError) {
        // If MFA unenroll fails, continue - might not have MFA or function not deployed
      }

      // Now update the password
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        throw error;
      }

      setStatus('success');

      // Redirect to login after a moment
      setTimeout(() => {
        // Sign out so they can log in with new password
        supabase.auth.signOut().then(() => {
          navigate('/Login');
        });
      }, 3000);

    } catch (error) {
      console.error('Error resetting password:', error);

      // Check if this is a session error
      if (error.message?.includes('session') || error.message?.includes('Auth')) {
        setPasswordError('Your session has expired. Please request a new password reset link.');
        setErrorMessage('Your session has expired. Please request a new password reset link.');
        setStatus('error');
      } else {
        setPasswordError(error.message || 'Failed to reset password. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-12">
            <Loader2 className="w-12 h-12 animate-spin text-slate-400 mb-4" />
            <p className="text-slate-600">Verifying your reset link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <img src="/logo.png" alt="Whit-Lend" className="h-16" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <CardTitle>Password Reset!</CardTitle>
                <CardDescription>Your password has been updated successfully</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-4">
              You can now sign in with your new password.
            </p>
            <p className="text-sm text-slate-500">
              Redirecting to login...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <img src="/logo.png" alt="Whit-Lend" className="h-16" />
            </div>
            <CardTitle className="text-center">Password Reset Error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-red-800">
                {errorMessage}
              </AlertDescription>
            </Alert>
            <p className="text-slate-600 text-sm text-center">
              If you need to reset your password, please contact your administrator or request a new reset link.
            </p>
            <Button onClick={() => navigate('/Login')} className="w-full">
              Back to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // status === 'ready'
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Whit-Lend" className="h-16" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <CardTitle>Reset Your Password</CardTitle>
              <CardDescription>Enter your new password below</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {passwordError && (
            <Alert className="mb-4 border-red-200 bg-red-50">
              <AlertDescription className="text-red-800">{passwordError}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your new password"
                  required
                  disabled={isSubmitting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <PasswordStrengthIndicator password={password} className="mt-2" />
              <PasswordRequirements password={password} className="mt-3" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                required
                disabled={isSubmitting}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting || !password || !confirmPassword}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reset Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
