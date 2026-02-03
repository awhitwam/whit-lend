import { useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { AlertTriangle, LogIn } from 'lucide-react';

/**
 * Dialog shown when a session error (RLS/JWT failure) is detected.
 * This typically happens when the Supabase JWT expires silently
 * before the app's inactivity timeout kicks in.
 */
export default function SessionErrorDialog() {
  const { sessionError, forceRelogin } = useAuth();

  const handleRelogin = useCallback(() => {
    forceRelogin();
  }, [forceRelogin]);

  if (!sessionError) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-red-50 border-b border-red-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Session Expired</h3>
              <p className="text-sm text-slate-600">Your session is no longer valid</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          <p className="text-slate-700 mb-4">
            Your authentication session has expired unexpectedly. This can happen due to:
          </p>
          <ul className="text-sm text-slate-600 space-y-1 mb-4 list-disc list-inside">
            <li>Network connectivity issues</li>
            <li>Session timeout on the server</li>
            <li>Browser security settings</li>
          </ul>
          <p className="text-slate-700">
            Please log in again to continue working.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6">
          <button
            onClick={handleRelogin}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Log In Again
          </button>
        </div>
      </div>
    </div>
  );
}
