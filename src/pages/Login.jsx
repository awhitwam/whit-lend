import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showTimeoutMessage, setShowTimeoutMessage] = useState(false);
  const { login } = useAuth();

  // Check if user was redirected due to session timeout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('timeout') === 'true') {
      setShowTimeoutMessage(true);
      // Clean up the URL
      window.history.replaceState({}, '', '/Login');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setShowTimeoutMessage(false);
    const { error } = await login(email, password);
    if (error) {
      alert("Login failed: " + error.message);
    } else {
      window.location.href = '/'; // Go to Dashboard on success
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100">
      <form onSubmit={handleSubmit} className="p-8 bg-white rounded shadow-md w-96">
        <h1 className="mb-6 text-2xl font-bold text-center">Lending App Login</h1>
        {showTimeoutMessage && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm text-center">
            Your session has expired due to inactivity. Please log in again.
          </div>
        )}
        <input 
          type="email" placeholder="Email" className="w-full p-2 mb-4 border rounded"
          value={email} onChange={(e) => setEmail(e.target.value)} required
        />
        <input 
          type="password" placeholder="Password" className="w-full p-2 mb-6 border rounded"
          value={password} onChange={(e) => setPassword(e.target.value)} required
        />
        <button type="submit" className="w-full p-2 text-white bg-blue-600 rounded hover:bg-blue-700">
          Sign In
        </button>
      </form>
    </div>
  );
};

export default Login;