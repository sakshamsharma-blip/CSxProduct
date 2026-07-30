import { useState } from 'react';
import { Navbar } from '../components/Navbar';
import { QueueTabs } from '../components/QueueTabs';
import { TicketTable } from '../components/TicketTable';
import { TicketDrawer } from '../components/TicketDrawer';
import { NewTicketModal } from '../components/NewTicketModal';
import { useTickets, filterTicketsByTab, getVisibleTickets, getAttentionTickets, needsWeeklyUpdate } from '../hooks/useTickets';
import { useAuth } from '../hooks/useAuth';
import { Ticket, QueueTab, UserRole } from '../types';

interface DashboardProps {
  onNavigateAnalytics: () => void;
  onNavigateUsers: () => void;
  onChangePassword: () => void;
}

export function Dashboard({ onNavigateAnalytics, onNavigateUsers, onChangePassword }: DashboardProps) {
  const { tickets, loading, refetch, holdExpiredCount } = useTickets();
  const { appUser } = useAuth();
  const [activeTab, setActiveTab] = useState<QueueTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const userRole = (appUser?.role as UserRole) || UserRole.CS_MANAGER;
  const userId = appUser?.id || '';

  // First apply role-based visibility, then tab filter
  const visibleTickets = getVisibleTickets(tickets, userRole, userId);
  const filteredTickets = filterTicketsByTab(visibleTickets, activeTab, userId);

  // Compute attention flags from current data (persists until action is taken)
  const attentionFlags = getAttentionTickets(visibleTickets);
  const slaBreachCount = visibleTickets.filter(t => needsWeeklyUpdate(t)).length;

  function handleSelectTicket(ticket: Ticket) {
    setSelectedTicket(ticket);
  }

  function handleCloseDrawer() {
    setSelectedTicket(null);
  }

  function handleTicketUpdate() {
    refetch();
    if (selectedTicket) {
      setTimeout(() => {
        refetch().then(() => {
          // Will re-render with updated data
        });
      }, 300);
    }
    setSelectedTicket(null);
  }

  function handleTicketCreated() {
    refetch();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading escalation data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Navbar
        onNewRequest={() => setShowNewModal(true)}
        onAnalytics={onNavigateAnalytics}
        onChangePassword={onChangePassword}
        onManageUsers={onNavigateUsers}
        currentPage="dashboard"
      />
      <QueueTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tickets={visibleTickets}
        userRole={userRole}
        userId={userId}
      />

      {/* Attention Banners — persist until the underlying issue is resolved */}
      {(holdExpiredCount > 0 || slaBreachCount > 0) && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-2.5 flex flex-wrap gap-4">
          {holdExpiredCount > 0 && (
            <p className="text-sm text-orange-800">
              <span className="font-semibold">⏰ {holdExpiredCount} ticket{holdExpiredCount > 1 ? 's' : ''}</span>
              {' '}returned from hold — moved to Pending Review.
            </p>
          )}
          {slaBreachCount > 0 && (
            <p className="text-sm text-red-700">
              <span className="font-semibold">🔴 {slaBreachCount} ticket{slaBreachCount > 1 ? 's' : ''}</span>
              {' '}overdue for weekly update (7+ days without activity).
            </p>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <TicketTable
          tickets={filteredTickets}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectTicket={handleSelectTicket}
          selectedTicketId={selectedTicket?.id || null}
          attentionFlags={attentionFlags}
        />
      </div>

      {/* Detail Drawer */}
      {selectedTicket && (
        <TicketDrawer
          ticket={selectedTicket}
          onClose={handleCloseDrawer}
          onUpdate={handleTicketUpdate}
        />
      )}

      {/* New Ticket Modal */}
      <NewTicketModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={handleTicketCreated}
      />
    </div>
  );
}
