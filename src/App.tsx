import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { Dashboard } from './pages/Dashboard';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UserManagement } from './pages/UserManagement';
import { OAuthConsentPage, OAUTH_CONSENT_PATH } from './pages/OAuthConsentPage';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { UserRole } from './types';

type Page = 'dashboard' | 'analytics' | 'users';

function AppContent() {
  const { session, appUser, loading, isRecoverySession, clearRecoveryState } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [showChangePassword, setShowChangePassword] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  // Force password set on recovery (forgot password or new invite)
  if (isRecoverySession) {
    return <SetPasswordPage onComplete={clearRecoveryState} />;
  }

  // "Allow Claude to use Flow as you?" — reached from an OAuth sign-in
  // (e.g. connecting the Flow MCP server in Claude). Login comes first above.
  if (window.location.pathname === OAUTH_CONSENT_PATH) {
    return <OAuthConsentPage />;
  }

  const canViewAnalytics = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD || appUser?.role === UserRole.PRODUCT_TEAM || appUser?.role === UserRole.ADMIN;
  const canManageUsers = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD || appUser?.role === UserRole.ADMIN;

  if (currentPage === 'analytics' && canViewAnalytics) {
    return (
      <>
        <AnalyticsPage onBack={() => setCurrentPage('dashboard')} />
        <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
      </>
    );
  }

  if (currentPage === 'users' && canManageUsers) {
    return (
      <>
        <UserManagement onBack={() => setCurrentPage('dashboard')} />
        <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
      </>
    );
  }

  return (
    <>
      <Dashboard
        onNavigateAnalytics={() => setCurrentPage('analytics')}
        onNavigateUsers={() => setCurrentPage('users')}
        onChangePassword={() => setShowChangePassword(true)}
      />
      <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
