import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { AppUser, UserRole } from '../types';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'CS Manager',
  [UserRole.CS_LEAD]: 'CS Lead',
  [UserRole.PRODUCT_LEAD]: 'Product Lead',
  [UserRole.ADMIN]: 'Admin',
};

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'bg-teal-100 text-teal-800',
  [UserRole.CS_LEAD]: 'bg-blue-100 text-blue-800',
  [UserRole.PRODUCT_LEAD]: 'bg-purple-100 text-purple-800',
  [UserRole.ADMIN]: 'bg-red-100 text-red-800',
};

interface UserManagementProps {
  onBack: () => void;
}

export function UserManagement({ onBack }: UserManagementProps) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Add single user
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState<UserRole>(UserRole.CS_MANAGER);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  // Bulk add
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkRole, setBulkRole] = useState<UserRole>(UserRole.CS_MANAGER);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState('');

  // Role change
  const [roleChangeLoading, setRoleChangeLoading] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: true });
    if (data) setUsers(data as AppUser[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    setAddLoading(true);

    try {
      const res = await supabase.functions.invoke('invite-user', {
        body: { email: addEmail.trim(), full_name: addName.trim(), role: addRole },
      });

      if (res.error) {
        setAddError(res.error.message || 'Failed to invite user');
      } else if (res.data?.error) {
        setAddError(res.data.error);
      } else {
        setAddSuccess(`Invite sent to ${addEmail}`);
        setAddEmail('');
        setAddName('');
        setAddRole(UserRole.CS_MANAGER);
        fetchUsers();
      }
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to invite user');
    }
    setAddLoading(false);
  }

  async function handleBulkAdd(e: React.FormEvent) {
    e.preventDefault();
    setBulkResult('');
    setBulkLoading(true);

    // Parse: each line is "email, full name" or just "email"
    const lines = bulkText.split('\n').filter(l => l.trim());
    const results: string[] = [];

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      const email = parts[0];
      const name = parts[1] || email.split('@')[0];

      if (!email || !email.includes('@')) {
        results.push(`✗ "${line}" — invalid email`);
        continue;
      }

      try {
        const res = await supabase.functions.invoke('invite-user', {
          body: { email, full_name: name, role: bulkRole },
        });

        if (res.error || res.data?.error) {
          results.push(`✗ ${email} — ${res.error?.message || res.data?.error}`);
        } else {
          results.push(`✓ ${email} — invited`);
        }
      } catch {
        results.push(`✗ ${email} — network error`);
      }
    }

    setBulkResult(results.join('\n'));
    setBulkLoading(false);
    fetchUsers();
  }

  async function handleRoleChange(userId: string, newRole: UserRole) {
    setRoleChangeLoading(userId);
    await supabase
      .from('app_users')
      .update({ role: newRole })
      .eq('id', userId);
    await fetchUsers();
    setRoleChangeLoading(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-gray-900">Manage Users</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Add Single User */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Invite New User</h2>
          <form onSubmit={handleAddUser} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="user@creliohealth.com"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-gray-500 mb-1">Full Name</label>
              <input
                type="text"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Doe"
              />
            </div>
            <div className="w-[140px]">
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <select
                value={addRole}
                onChange={e => setAddRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={UserRole.CS_MANAGER}>CS Manager</option>
                <option value={UserRole.CS_LEAD}>CS Lead</option>
                <option value={UserRole.PRODUCT_LEAD}>Product Lead</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={addLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {addLoading ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
          {addError && <p className="text-sm text-red-600 mt-2">{addError}</p>}
          {addSuccess && <p className="text-sm text-green-600 mt-2">{addSuccess}</p>}

          <div className="mt-3">
            <button
              onClick={() => setShowBulk(!showBulk)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              {showBulk ? 'Hide bulk invite' : 'Bulk invite multiple users'}
            </button>
          </div>

          {/* Bulk Add */}
          {showBulk && (
            <form onSubmit={handleBulkAdd} className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-xs text-gray-500 mb-2">
                One user per line. Format: <code className="bg-gray-100 px-1 rounded">email, Full Name</code>
              </p>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                placeholder={"rahul@creliohealth.com, Rahul Kumar\npriya@creliohealth.com, Priya Singh"}
              />
              <div className="flex items-center gap-3">
                <select
                  value={bulkRole}
                  onChange={e => setBulkRole(e.target.value as UserRole)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value={UserRole.CS_MANAGER}>CS Manager</option>
                  <option value={UserRole.CS_LEAD}>CS Lead</option>
                  <option value={UserRole.PRODUCT_LEAD}>Product Lead</option>
                </select>
                <button
                  type="submit"
                  disabled={bulkLoading || !bulkText.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {bulkLoading ? 'Processing...' : 'Invite All'}
                </button>
              </div>
              {bulkResult && (
                <pre className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {bulkResult}
                </pre>
              )}
            </form>
          )}
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              All Users <span className="text-gray-400 font-normal">({users.length})</span>
            </h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading users...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Email</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map(user => (
                    <tr key={user.id}>
                      <td className="px-5 py-3 font-medium text-gray-900">{user.full_name}</td>
                      <td className="px-5 py-3 text-gray-600">{user.email}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE_COLORS[user.role as UserRole]}`}>
                          {ROLE_LABELS[user.role as UserRole]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
