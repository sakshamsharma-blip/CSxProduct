import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UserRole } from './types';

type Page = 'dashboard' | 'analytics';

function AppContent() {
  const { session, appUser, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  // Only CS Lead and Product Lead can access analytics
  const canViewAnalytics = appUser?.role === UserRole.CS_LEAD || appUser?.role === UserRole.PRODUCT_LEAD;

  if (currentPage === 'analytics' && canViewAnalytics) {
    return <AnalyticsPage onBack={() => setCurrentPage('dashboard')} />;
  }

  return <Dashboard onNavigateAnalytics={() => setCurrentPage('analytics')} />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
