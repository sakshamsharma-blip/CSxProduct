import { useAuth } from '../hooks/useAuth';
import { UserRole } from '../types';

interface NavbarProps {
  onNewRequest: () => void;
  onAnalytics: () => void;
  currentPage: 'dashboard' | 'analytics';
}

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'CS Manager',
  [UserRole.CS_LEAD]: 'CS Lead',
  [UserRole.PRODUCT_LEAD]: 'Product Lead',
};

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'bg-teal-100 text-teal-800',
  [UserRole.CS_LEAD]: 'bg-blue-100 text-blue-800',
  [UserRole.PRODUCT_LEAD]: 'bg-purple-100 text-purple-800',
};

export function Navbar({ onNewRequest, onAnalytics, currentPage }: NavbarProps) {
  const { appUser, signOut } = useAuth();

  const canCreate = appUser?.role === UserRole.CS_MANAGER || appUser?.role === UserRole.CS_LEAD;
  const canViewAnalytics = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD;

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between max-w-full">
        {/* Left: Branding */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-sm">LE</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">LIMS Escalation Portal</h1>
        </div>

        {/* Right: Actions + User Info */}
        <div className="flex items-center gap-4">
          {/* Analytics Button */}
          {canViewAnalytics && currentPage !== 'analytics' && (
            <button
              onClick={onAnalytics}
              className="text-gray-600 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              Analytics
            </button>
          )}

          {/* New Request Button */}
          {canCreate && currentPage !== 'analytics' && (
            <button
              onClick={onNewRequest}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1"
            >
              <span className="text-lg leading-none">+</span> New Request
            </button>
          )}

          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{appUser?.full_name}</p>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE_COLORS[appUser?.role as UserRole] || ''}`}>
                {ROLE_LABELS[appUser?.role as UserRole] || appUser?.role}
              </span>
            </div>
            <button
              onClick={signOut}
              className="text-gray-400 hover:text-gray-600 text-sm"
              title="Sign out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3zm11 4.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L11.586 7H7a1 1 0 1 1 0-2h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V7.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
