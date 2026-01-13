import { useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Clock, LogOut } from 'lucide-react';

export default function SessionTimeoutWarning() {
  const { logout, resetActivityTimer, showTimeoutWarning, timeoutSecondsRemaining } = useAuth();

  // Format seconds to MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle stay logged in - clicking the button triggers user activity
  // which automatically resets the timer via the activity event listeners
  const handleStayLoggedIn = useCallback(() => {
    // Explicitly reset activity timer (clicking also does this via event listener)
    resetActivityTimer();
  }, [resetActivityTimer]);

  // Handle logout
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  if (!showTimeoutWarning) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Session Expiring Soon</h3>
              <p className="text-sm text-slate-600">Your session will expire due to inactivity</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 text-center">
          <div className="text-4xl font-mono font-bold text-slate-900 mb-2">
            {formatTime(timeoutSecondsRemaining)}
          </div>
          <p className="text-slate-600 text-sm">
            You will be automatically logged out when the timer reaches zero.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleLogout}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
          <button
            onClick={handleStayLoggedIn}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Stay Logged In
          </button>
        </div>
      </div>
    </div>
  );
}
