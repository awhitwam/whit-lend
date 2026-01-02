import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Smartphone,
  Laptop,
  Trash2,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const MFAManagement = () => {
  const {
    user,
    mfaFactors,
    checkMfaStatus,
    getTrustedDevices,
    removeTrustedDevice,
    untrustDevice
  } = useAuth();

  const [trustedDevices, setTrustedDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removingDevice, setRemovingDevice] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Get current device token to highlight it
  const currentDeviceToken = localStorage.getItem('mfa_device_token');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await checkMfaStatus();
      const devices = await getTrustedDevices();
      setTrustedDevices(devices);
    } catch (err) {
      setError('Failed to load security settings');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDevice = async (deviceId, isCurrentDevice) => {
    try {
      setRemovingDevice(deviceId);
      setError(null);

      if (isCurrentDevice) {
        await untrustDevice();
      } else {
        await removeTrustedDevice(deviceId);
      }

      setSuccess('Device removed successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Reload devices
      const devices = await getTrustedDevices();
      setTrustedDevices(devices);
    } catch (err) {
      setError('Failed to remove device');
    } finally {
      setRemovingDevice(null);
    }
  };

  const getDeviceIcon = (deviceName) => {
    if (deviceName?.toLowerCase().includes('mobile') ||
        deviceName?.toLowerCase().includes('android') ||
        deviceName?.toLowerCase().includes('ios')) {
      return <Smartphone className="h-5 w-5 text-slate-500" />;
    }
    return <Laptop className="h-5 w-5 text-slate-500" />;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* MFA Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>
            Protect your account with an authenticator app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-emerald-200 bg-emerald-50">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-800">{success}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">2FA is enabled</p>
                <p className="text-sm text-slate-500">
                  {mfaFactors.length} authenticator{mfaFactors.length !== 1 ? 's' : ''} enrolled
                </p>
              </div>
            </div>
          </div>

          {mfaFactors.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-700">Enrolled Authenticators</h4>
              {mfaFactors.map((factor) => (
                <div
                  key={factor.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-slate-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {factor.friendly_name || 'Authenticator App'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Added {factor.created_at ? formatDistanceToNow(new Date(factor.created_at), { addSuffix: true }) : 'recently'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                    Active
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trusted Devices Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-slate-600" />
            Trusted Devices
          </CardTitle>
          <CardDescription>
            Devices that can skip 2FA verification for 7 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trustedDevices.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Laptop className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p>No trusted devices</p>
              <p className="text-sm mt-1">
                Check "Trust this browser" when logging in to add devices
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {trustedDevices.map((device) => {
                const isCurrentDevice = device.device_token === currentDeviceToken;
                const isExpired = new Date(device.trusted_until) < new Date();

                return (
                  <div
                    key={device.id}
                    className={`flex items-center justify-between p-4 border rounded-lg ${
                      isCurrentDevice ? 'border-blue-200 bg-blue-50' : ''
                    } ${isExpired ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {getDeviceIcon(device.device_name)}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">
                            {device.device_name || 'Unknown Device'}
                          </p>
                          {isCurrentDevice && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                              This device
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                          <Clock className="h-3 w-3" />
                          {isExpired ? (
                            <span className="text-amber-600">Expired</span>
                          ) : (
                            <span>
                              Trusted until {format(new Date(device.trusted_until), 'MMM d, yyyy')}
                            </span>
                          )}
                        </div>
                        {device.last_used && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Last used {formatDistanceToNow(new Date(device.last_used), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveDevice(device.id, isCurrentDevice)}
                      disabled={removingDevice === device.id}
                      className="text-slate-500 hover:text-red-600 hover:bg-red-50"
                    >
                      {removingDevice === device.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Security</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-slate-600 space-y-2">
            <p>
              <span className="font-medium">Email:</span> {user?.email}
            </p>
            <p>
              <span className="font-medium">Session timeout:</span> 20 minutes of inactivity
            </p>
            <p>
              <span className="font-medium">Device trust period:</span> 7 days
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MFAManagement;
