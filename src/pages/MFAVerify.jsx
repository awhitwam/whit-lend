import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield, AlertTriangle, LogOut } from 'lucide-react';

const MFAVerify = () => {
  const navigate = useNavigate();
  const { user, verifyMfa, trustDevice, logout, checkTrustedDevice, checkMfaStatus } = useAuth();
  const inputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [trustThisDevice, setTrustThisDevice] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const maxAttempts = 5;

  useEffect(() => {
    checkInitialStatus();
  }, []);

  useEffect(() => {
    // Focus input on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [loading]);

  const checkInitialStatus = async () => {
    try {
      setLoading(true);

      // Check if device is already trusted
      const isTrusted = await checkTrustedDevice();
      if (isTrusted) {
        // Auto-verify using trusted device
        const status = await checkMfaStatus();
        if (!status.mfaRequired) {
          navigate('/');
          return;
        }
      }

      // Verify we have a factor ID
      await checkMfaStatus();
    } catch (err) {
      console.error('Error checking status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    console.log('[MFAVerify Debug] handleVerify called');

    if (verificationCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    if (attempts >= maxAttempts) {
      setError('Too many failed attempts. Please log in again.');
      return;
    }

    try {
      setVerifying(true);
      setError(null);
      console.log('[MFAVerify Debug] Calling verifyMfa...');

      await verifyMfa(verificationCode);
      console.log('[MFAVerify Debug] verifyMfa completed successfully');

      // Trust this device if checkbox is checked
      if (trustThisDevice) {
        console.log('[MFAVerify Debug] Trusting device...');
        try {
          await trustDevice();
          console.log('[MFAVerify Debug] Device trusted successfully');
        } catch (trustErr) {
          console.error('[MFAVerify Debug] Failed to trust device:', trustErr);
          // Don't fail if trusting fails
        }
      }

      // Redirect to dashboard
      console.log('[MFAVerify Debug] Navigating to dashboard...');
      navigate('/');
    } catch (err) {
      console.error('[MFAVerify Debug] Verification failed:', err);
      setAttempts(prev => prev + 1);
      setError(err.message || 'Invalid verification code. Please try again.');
      setVerificationCode('');
      inputRef.current?.focus();
    } finally {
      console.log('[MFAVerify Debug] Setting verifying to false');
      setVerifying(false);
    }
  };

  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(value);
    setError(null);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout failed:', err);
      // Force redirect even if logout fails
      window.location.href = '/Login';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Checking authentication status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Whit-Lend" className="h-16" />
          </div>
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="h-6 w-6 text-blue-600" />
          </div>
          <CardTitle className="text-xl">Two-Factor Authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {attempts >= maxAttempts ? (
            <div className="text-center space-y-4">
              <p className="text-slate-600">
                You've exceeded the maximum number of attempts.
              </p>
              <Button onClick={handleLogout} variant="outline" className="w-full">
                <LogOut className="h-4 w-4 mr-2" />
                Log Out and Try Again
              </Button>
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <Input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={handleCodeChange}
                  className="text-center text-2xl tracking-widest font-mono"
                  maxLength={6}
                  autoComplete="one-time-code"
                  disabled={verifying}
                />
                {attempts > 0 && attempts < maxAttempts && (
                  <p className="text-sm text-amber-600 mt-2 text-center">
                    {maxAttempts - attempts} attempts remaining
                  </p>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={trustThisDevice}
                  onChange={(e) => setTrustThisDevice(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-600">Trust this browser for 7 days</span>
              </label>

              <Button
                type="submit"
                className="w-full"
                disabled={verifying || verificationCode.length !== 6}
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify'
                )}
              </Button>
            </form>
          )}

          <div className="pt-4 border-t space-y-3">
            <div className="text-center text-sm text-slate-500">
              Logged in as <span className="font-medium">{user?.email}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="w-full text-slate-500 hover:text-slate-700"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MFAVerify;
