import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Shield, Smartphone, Copy, Check, AlertTriangle } from 'lucide-react';

const MFASetup = () => {
  const navigate = useNavigate();
  const { user, enrollMfa, verifyMfa, checkMfaStatus, trustDevice } = useAuth();

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const [trustThisDevice, setTrustThisDevice] = useState(true);

  useEffect(() => {
    initializeEnrollment();
  }, []);

  const initializeEnrollment = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if user already has MFA enrolled
      const status = await checkMfaStatus();
      if (status.enrolled) {
        // Already enrolled, redirect to dashboard
        navigate('/');
        return;
      }

      // Start enrollment process
      const enrollData = await enrollMfa();
      setQrCode(enrollData.qrCode);
      setSecret(enrollData.secret);
      setFactorId(enrollData.factorId);
    } catch (err) {
      setError(err.message || 'Failed to initialize MFA enrollment');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy secret:', err);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();

    if (verificationCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    try {
      setVerifying(true);
      setError(null);

      await verifyMfa(verificationCode, factorId);

      // Trust this device if checkbox is checked
      if (trustThisDevice) {
        try {
          await trustDevice();
        } catch (trustErr) {
          console.error('Failed to trust device:', trustErr);
          // Don't fail the whole process if trusting fails
        }
      }

      setSuccess(true);

      // Redirect to dashboard after short delay
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err) {
      setError(err.message || 'Invalid verification code. Please try again.');
      setVerificationCode('');
    } finally {
      setVerifying(false);
    }
  };

  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(value);
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Setting up two-factor authentication...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Two-Factor Authentication Enabled</h2>
            <p className="text-slate-600">Your account is now protected with 2FA.</p>
            <p className="text-sm text-slate-500 mt-2">Redirecting to dashboard...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="h-8 w-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl">Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>
            Protect your account with an authenticator app
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {/* Step 1: Download App */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium">1</div>
              <h3 className="font-medium text-slate-900">Download an authenticator app</h3>
            </div>
            <div className="ml-11 flex items-center gap-4 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                <span>Google Authenticator</span>
              </div>
              <span>or</span>
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                <span>Microsoft Authenticator</span>
              </div>
            </div>
          </div>

          {/* Step 2: Scan QR Code */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium">2</div>
              <h3 className="font-medium text-slate-900">Scan the QR code</h3>
            </div>
            <div className="ml-11">
              {qrCode && (
                <div className="bg-white p-4 rounded-lg border inline-block">
                  <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
                </div>
              )}

              {/* Manual entry option */}
              <div className="mt-4">
                <p className="text-sm text-slate-600 mb-2">Can't scan? Enter this code manually:</p>
                <div className="flex items-center gap-2">
                  <code className="bg-slate-100 px-3 py-2 rounded text-sm font-mono flex-1 break-all">
                    {secret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopySecret}
                    className="shrink-0"
                  >
                    {secretCopied ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Enter Verification Code */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium">3</div>
              <h3 className="font-medium text-slate-900">Enter the 6-digit code from your app</h3>
            </div>
            <form onSubmit={handleVerify} className="ml-11 space-y-4">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="000000"
                value={verificationCode}
                onChange={handleCodeChange}
                className="text-center text-2xl tracking-widest font-mono"
                maxLength={6}
                autoComplete="one-time-code"
              />

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
                  'Verify & Enable 2FA'
                )}
              </Button>
            </form>
          </div>

          <div className="text-center text-sm text-slate-500 pt-4 border-t">
            Logged in as <span className="font-medium">{user?.email}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MFASetup;
