import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Building2, User } from 'lucide-react';

export default function AcceptInvitation() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState('loading'); // loading, needs_profile, accepted, error
  const [errorMessage, setErrorMessage] = useState('');
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      // Check if user has a profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('id', authUser.id)
        .single();

      if (!profile?.full_name) {
        // Need to collect user's name
        setStatus('needs_profile');
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

  const handleProfileSubmit = async (e) => {
    e.preventDefault();

    if (!fullName.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        throw new Error('User not found');
      }

      // Create or update user profile
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({
          id: authUser.id,
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

  if (status === 'needs_profile') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <CardTitle>Welcome!</CardTitle>
                <CardDescription>Complete your profile to continue</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-md mb-6">
              <p className="text-sm text-emerald-800">
                You've been invited to join <strong>{orgName}</strong> as a <strong>{role}</strong>.
              </p>
            </div>

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

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Continue
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
