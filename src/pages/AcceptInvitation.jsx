import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, Building2 } from 'lucide-react';

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [invitation, setInvitation] = useState(null);
  const [status, setStatus] = useState('loading'); // loading, valid, invalid, accepted, error
  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      validateInvitation();
    } else {
      setStatus('invalid');
    }
  }, [token]);

  const validateInvitation = async () => {
    try {
      setStatus('loading');

      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          organization:organizations(id, name, description)
        `)
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (error || !data) {
        setStatus('invalid');
        return;
      }

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        setStatus('invalid');
        return;
      }

      setInvitation(data);
      setStatus('valid');
    } catch (error) {
      console.error('Error validating invitation:', error);
      setStatus('error');
    }
  };

  const acceptInvitation = async () => {
    if (!isAuthenticated) {
      // Save token and redirect to login
      localStorage.setItem('pendingInvitationToken', token);
      navigate('/Login');
      return;
    }

    try {
      setStatus('loading');

      // Create organization member
      await base44.entities.OrganizationMember.create({
        organization_id: invitation.organization.id,
        user_id: user.id,
        role: invitation.role,
        invited_by: invitation.invited_by,
        invited_at: invitation.created_at,
        joined_at: new Date().toISOString(),
        is_active: true
      });

      // Mark invitation as accepted
      await supabase
        .from('invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('id', invitation.id);

      setStatus('accepted');

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        navigate('/');
        window.location.reload(); // Force reload to fetch new organization
      }, 2000);
    } catch (error) {
      console.error('Error accepting invitation:', error);
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-12">
            <Loader2 className="w-12 h-12 animate-spin text-slate-400 mb-4" />
            <p className="text-slate-600">Validating invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <CardTitle>Invalid Invitation</CardTitle>
                <CardDescription>This invitation link is not valid</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-600">
              This invitation may have expired or already been used. Please contact your organization administrator for a new invitation.
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              Go to Dashboard
            </Button>
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
                <CardTitle>Invitation Accepted!</CardTitle>
                <CardDescription>Welcome to {invitation.organization.name}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-4">
              You've successfully joined the organization as a <strong>{invitation.role}</strong>.
            </p>
            <p className="text-sm text-slate-500">
              Redirecting to dashboard...
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
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <CardTitle>Error</CardTitle>
                <CardDescription>Something went wrong</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-600">
              We encountered an error while processing your invitation. Please try again or contact support.
            </p>
            <Button onClick={() => window.location.reload()} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // status === 'valid'
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <CardTitle>Join Organization</CardTitle>
              <CardDescription>You've been invited!</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-slate-50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Organization:</span>
              <span className="font-medium">{invitation?.organization.name}</span>
            </div>
            {invitation?.organization.description && (
              <p className="text-sm text-slate-600">{invitation.organization.description}</p>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Your Role:</span>
              <span className="font-medium">{invitation?.role}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Invited to:</span>
              <span className="font-medium">{invitation?.email}</span>
            </div>
          </div>

          {!isAuthenticated && (
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-md">
              <p className="text-sm text-blue-800">
                You'll need to sign in before accepting this invitation.
              </p>
            </div>
          )}

          <Button onClick={acceptInvitation} className="w-full">
            {isAuthenticated ? 'Accept Invitation' : 'Sign In to Accept'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
