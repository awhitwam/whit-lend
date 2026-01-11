import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Loader2 } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoggingIn(true);

    try {
      const { error } = await login(email, password);
      if (error) {
        setErrorMessage(error.message);
        setIsLoggingIn(false);
        return;
      }

      // MFA is disabled - go directly to dashboard
      // (MFA enforcement is controlled by MFA_ENFORCEMENT_ENABLED in App.jsx)
      navigate('/');
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred during login');
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100">
      <form onSubmit={handleSubmit} className="p-8 bg-white rounded shadow-md w-[480px]">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="Whit-Lend" className="h-96" />
        </div>
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm text-center">
            {errorMessage}
          </div>
        )}
        <input
          type="email" placeholder="Email" className="w-full p-2 mb-4 border rounded"
          value={email} onChange={(e) => setEmail(e.target.value)} required
          disabled={isLoggingIn}
        />
        <input
          type="password" placeholder="Password" className="w-full p-2 mb-6 border rounded"
          value={password} onChange={(e) => setPassword(e.target.value)} required
          disabled={isLoggingIn}
        />
        <button
          type="submit"
          className="w-full p-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          disabled={isLoggingIn}
        >
          {isLoggingIn ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Signing In...
            </>
          ) : (
            'Sign In'
          )}
        </button>
      </form>
    </div>
  );
};

export default Login;