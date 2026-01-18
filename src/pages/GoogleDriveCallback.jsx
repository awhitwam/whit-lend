/**
 * Google Drive OAuth Callback Page
 *
 * Handles the redirect from Google OAuth and exchanges the code for tokens
 */

import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function GoogleDriveCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoadingAuth } = useAuth();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const hasProcessed = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Wait for auth to finish loading
      if (isLoadingAuth) return;

      // Prevent double processing
      if (hasProcessed.current) return;

      const code = searchParams.get('code');
      const error = searchParams.get('error');

      if (error) {
        hasProcessed.current = true;
        setStatus('error');
        setErrorMessage(error === 'access_denied'
          ? 'Access was denied. Please try again.'
          : `OAuth error: ${error}`
        );
        return;
      }

      if (!code) {
        hasProcessed.current = true;
        setStatus('error');
        setErrorMessage('No authorization code received');
        return;
      }

      // Wait for user to be available (indicates authentication is complete)
      if (!user) {
        console.log('[GoogleDriveCallback] Waiting for user...');
        return;
      }

      hasProcessed.current = true;

      try {
        // Get the session directly from Supabase to access the access_token
        // Note: useAuth() doesn't expose the session object, only user and isAuthenticated
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token) {
          throw new Error('No valid session. Please log in again.');
        }

        console.log('[GoogleDriveCallback] Got session, calling edge function...');

        const redirectUri = `${window.location.origin}/GoogleDriveCallback`;

        // Call the Edge Function with explicit headers to ensure auth is passed
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-auth`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ code, redirect_uri: redirectUri })
          }
        );

        const data = await response.json();
        console.log('[GoogleDriveCallback] Response:', response.status, data);

        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}: ${JSON.stringify(data)}`);
        }

        if (data.error) {
          throw new Error(data.error);
        }

        setStatus('success');
        toast.success(`Connected to Google Drive as ${data.email}`);

        // Redirect to settings after a short delay
        setTimeout(() => {
          navigate('/Config', { replace: true });
        }, 1500);
      } catch (err) {
        console.error('OAuth callback error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'Failed to connect Google Drive');
      }
    };

    handleCallback();
  }, [searchParams, user, isLoadingAuth, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4 text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900">Connecting to Google Drive</h2>
            <p className="text-slate-500 mt-2">Please wait while we complete the connection...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900">Connected Successfully!</h2>
            <p className="text-slate-500 mt-2">Redirecting to settings...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900">Connection Failed</h2>
            <p className="text-red-600 mt-2">{errorMessage}</p>
            <button
              onClick={() => navigate('/Config', { replace: true })}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800"
            >
              Return to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
