import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { BrandLogo } from '../components/BrandLogo';

interface SetPasswordPageProps {
  onComplete: () => void;
}

export function SetPasswordPage({ onComplete }: SetPasswordPageProps) {
  const { changePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await changePassword(newPassword);
    if (error) {
      setError(error.message || 'Failed to set password');
    } else {
      onComplete();
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <BrandLogo size="lg" />
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Set Your Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            Choose a password to secure your account. You'll use this to sign in going forward.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="newPass" className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <input
                id="newPass"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Min 6 characters"
              />
            </div>

            <div>
              <label htmlFor="confirmPass" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPass"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Re-enter password"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? 'Setting password...' : 'Set Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
