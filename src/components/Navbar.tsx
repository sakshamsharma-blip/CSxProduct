import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UserRole } from '../types';
import { BrandLogo } from './BrandLogo';

interface NavbarProps {
  onNewRequest: () => void;
  onAnalytics: () => void;
  onChangePassword: () => void;
  onManageUsers: () => void;
  currentPage: 'dashboard' | 'analytics' | 'users';
}

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'CS Manager',
  [UserRole.CS_LEAD]: 'CS Lead',
  [UserRole.PRODUCT_LEAD]: 'Product Lead',
  [UserRole.ADMIN]: 'Admin',
};

export function Navbar({ onNewRequest, onAnalytics, onChangePassword, onManageUsers, currentPage }: NavbarProps) {
  const { appUser, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const canCreate = appUser?.role === UserRole.CS_MANAGER || appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.ADMIN;
  const canViewAnalytics = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD || appUser?.role === UserRole.ADMIN;
  const canManageUsers = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD || appUser?.role === UserRole.ADMIN;

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between max-w-full">
        {/* Left: Branding */}
        <div className="flex items-center">
          <BrandLogo size="md" productName="Pulse" />
        </div>

        {/* Right: Actions + User Info */}
        <div className="flex items-center gap-4">
          {/* Analytics Button */}
          {canViewAnalytics && currentPage === 'dashboard' && (
            <button
              onClick={onAnalytics}
              className="text-gray-600 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              Analytics
            </button>
          )}

          {/* New Request Button */}
          {canCreate && currentPage === 'dashboard' && (
            <button
              onClick={onNewRequest}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
            >
              <span className="text-lg leading-none">+</span> New Request
            </button>
          )}

          {/* User Menu */}
          <div className="relative pl-4 border-l border-gray-200" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 hover:bg-gray-50 rounded-md px-2 py-1.5 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                <span className="text-white text-xs font-semibold">
                  {appUser?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium text-gray-900 leading-tight">{appUser?.full_name}</p>
                <p className="text-xs text-gray-500 leading-tight">{ROLE_LABELS[appUser?.role as UserRole] || appUser?.role}</p>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                {/* User info header */}
                <div className="px-4 py-2 border-b border-gray-100 sm:hidden">
                  <p className="text-sm font-medium text-gray-900">{appUser?.full_name}</p>
                  <p className="text-xs text-gray-500">{ROLE_LABELS[appUser?.role as UserRole]}</p>
                </div>

                {canManageUsers && (
                  <button
                    onClick={() => { setMenuOpen(false); onManageUsers(); }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                    </svg>
                    Manage Users
                  </button>
                )}

                <button
                  onClick={() => { setMenuOpen(false); onChangePassword(); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Change Password
                </button>

                <div className="border-t border-gray-100 my-1"></div>

                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3zm11 4.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L11.586 7H7a1 1 0 1 1 0-2h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V7.414z" clipRule="evenodd" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
