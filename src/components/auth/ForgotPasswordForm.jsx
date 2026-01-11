import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Loader2, Mail, CheckCircle2, ArrowLeft } from 'lucide-react';

export function ForgotPasswordForm({ onBack }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle, submitting, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const { resetPasswordForEmail } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage('');

    try {
      const { error } = await resetPasswordForEmail(email);
      if (error) {
        setErrorMessage(error.message);
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to send reset email');
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-medium text-slate-900">Check your email</h3>
          <p className="text-sm text-slate-600 mt-1">
            We've sent a password reset link to <strong>{email}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full p-2 text-slate-700 bg-slate-100 rounded hover:bg-slate-200 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-2">
        <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-3">
          <Mail className="w-6 h-6 text-blue-600" />
        </div>
        <h3 className="font-medium text-slate-900">Forgot your password?</h3>
        <p className="text-sm text-slate-600 mt-1">
          Enter your email and we'll send you a reset link
        </p>
      </div>

      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm text-center">
          {errorMessage}
        </div>
      )}

      <input
        type="email"
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={status === 'submitting'}
        className="w-full p-2 border rounded"
      />

      <button
        type="submit"
        className="w-full p-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Sending...
          </>
        ) : (
          'Send Reset Link'
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full p-2 text-slate-600 hover:text-slate-900 flex items-center justify-center"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Sign In
      </button>
    </form>
  );
}

export default ForgotPasswordForm;
