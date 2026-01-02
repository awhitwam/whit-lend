import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, User, Eye, EyeOff } from 'lucide-react';

export default function AcceptInvitation() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, needs_setup, accepted, error
  const [errorMessage, setErrorMessage] = useState('');
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(true); // New users need to set password

  useEffect(() => {
    handleInviteCallback();
  }, []);

  const handleInviteCallback = async () => {
    try {
      // Supabase Auth handles the token exchange automatically when using the client
      // We just need to check if the user is now authenticated
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Session error:', sessionError);
        setErrorMessage('Failed to process invitation. Please try again.');
        setStatus('error');
        return;
      }

      if (!session) {
        // Check URL for error parameters (e.g., expired link)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const error = hashParams.get('error');
        const errorDescription = hashParams.get('error_description');

        if (error) {
          setErrorMessage(errorDescription || 'The invitation link is invalid or has expired.');
          setStatus('error');
          return;
        }

        // No session and no error - might be first load, try to exchange the token
        // Supabase client auto-handles this, but let's wait a moment
        const { data: { session: retrySession } } = await supabase.auth.getSession();

        if (!retrySession) {
          setErrorMessage('Unable to process invitation. Please request a new invite.');
          setStatus('error');
          return;
        }
      }

      // User is authenticated, get their details
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        setErrorMessage('Unable to retrieve user information.');
        setStatus('error');
        return;
      }

      // Get organization details from user metadata (set during invite)
      const orgId = authUser.user_metadata?.organization_id;
      const inviteRole = authUser.user_metadata?.role;
      const organizationName = authUser.user_metadata?.organization_name;

      if (!orgId) {
        // This might be a returning user, just redirect to dashboard
        navigate('/');
        return;
      }

      setOrgName(organizationName || 'the organization');
      setRole(inviteRole || 'Member');

      // Activate the pending organization member record
      const { error: updateError } = await supabase
        .from('organization_members')
        .update({
          is_active: true,
          joined_at: new Date().toISOString()
        })
        .eq('organization_id', orgId)
        .eq('user_id', authUser.id);

      if (updateError) {
        console.error('Error activating membership:', updateError);
        // Don't fail - the user might already be active
      }

      // Check if user has a profile with name set
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('id', authUser.id)
        .single();

      // Check if this is a new invite (user created via invite vs existing user)
      // New users from inviteUserByEmail have identities but no confirmed_at initially
      // or were created very recently (within last few minutes)
      const userCreatedAt = new Date(authUser.created_at);
      const isRecentlyCreated = (Date.now() - userCreatedAt.getTime()) < 5 * 60 * 1000; // 5 minutes

      // If no profile name or recently created, need to complete setup
      if (!profile?.full_name || isRecentlyCreated) {
        // Check if user has a password set by checking if they have an email identity
        // Users invited via magic link need to set a password
        const hasEmailIdentity = authUser.identities?.some(i => i.provider === 'email');
        setNeedsPassword(isRecentlyCreated && hasEmailIdentity);
        setStatus('needs_setup');
        return;
      }

      // All done!
      setStatus('accepted');

      // Redirect after a moment
      setTimeout(() => {
        navigate('/');
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('Error processing invitation:', error);
      setErrorMessage(error.message || 'An unexpected error occurred.');
      setStatus('error');
    }
  };

  const validatePassword = (pwd) => {
    if (pwd.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/[A-Z]/.test(pwd)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(pwd)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(pwd)) {
      return 'Password must contain at least one number';
    }
    return null;
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (!fullName.trim()) {
      return;
    }

    // Validate password if needed
    if (needsPassword) {
      const pwdError = validatePassword(password);
      if (pwdError) {
        setPasswordError(pwdError);
        return;
      }
      if (password !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        throw new Error('User not found');
      }

      // Set password if needed (new user from invite)
      if (needsPassword && password) {
        const { error: passwordError } = await supabase.auth.updateUser({
          password: password
        });

        if (passwordError) {
          throw new Error(`Failed to set password: ${passwordError.message}`);
        }
      }

      // Create or update user profile
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({
          id: authUser.id,
          email: authUser.email,
          full_name: fullName.trim(),
          updated_at: new Date().toISOString()
        });

      if (upsertError) {
        throw upsertError;
      }

      setStatus('accepted');

      // Redirect after a moment
      setTimeout(() => {
        navigate('/');
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('Error saving profile:', error);
      setErrorMessage(error.message || 'Failed to save profile');
      setStatus('error');
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
            <p className="text-slate-600">Processing your invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'needs_setup') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <img src="/logo.png" alt="Whit-Lend" className="h-16" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <CardTitle>Welcome!</CardTitle>
                <CardDescription>Complete your account setup to continue</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-md mb-6">
              <p className="text-sm text-emerald-800">
                You've been invited to join <strong>{orgName}</strong> as a <strong>{role}</strong>.
              </p>
            </div>

            {passwordError && (
              <Alert className="mb-4 border-red-200 bg-red-50">
                <AlertDescription className="text-red-800">{passwordError}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Your Full Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                  disabled={isSubmitting}
                />
              </div>

              {needsPassword && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">Create Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter a strong password"
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
                    <p className="text-xs text-slate-500">
                      At least 8 characters with uppercase, lowercase, and number
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                </>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting || (needsPassword && (!password || !confirmPassword))}>
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {needsPassword ? 'Create Account' : 'Continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'accepted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <CardTitle>Welcome to {orgName}!</CardTitle>
                <CardDescription>You've successfully joined</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-4">
              You're now a <strong>{role}</strong> of the organization.
            </p>
            <p className="text-sm text-slate-500">
              Redirecting to dashboard...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // status === 'error'
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <CardTitle>Invitation Error</CardTitle>
              <CardDescription>Unable to process invitation</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-600">
            {errorMessage || 'We encountered an error while processing your invitation. Please contact your organization administrator for a new invitation.'}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/Login')} variant="outline" className="flex-1">
              Sign In
            </Button>
            <Button onClick={() => navigate('/')} className="flex-1">
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
