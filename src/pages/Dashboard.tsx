import { useState } from 'react';
import { Navbar } from '../components/Navbar';
import { QueueTabs } from '../components/QueueTabs';
import { TicketTable } from '../components/TicketTable';
import { TicketDrawer } from '../components/TicketDrawer';
import { NewTicketModal } from '../components/NewTicketModal';
import { useTickets, filterTicketsByTab, getVisibleTickets } from '../hooks/useTickets';
import { useAuth } from '../hooks/useAuth';
import { Ticket, QueueTab, UserRole } from '../types';

export function Dashboard() {
  const { tickets, loading, refetch } = useTickets();
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

  function handleSelectTicket(ticket: Ticket) {
    setSelectedTicket(ticket);
  }

  function handleCloseDrawer() {
    setSelectedTicket(null);
  }

  function handleTicketUpdate() {
    refetch();
    // Refresh selected ticket data
    if (selectedTicket) {
      setTimeout(() => {
        const updated = tickets.find(t => t.id === selectedTicket.id);
        if (updated) setSelectedTicket(updated);
      }, 500);
    }
  }

  function handleTicketCreated() {
    refetch();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading escalation data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Navbar onNewRequest={() => setShowNewModal(true)} />
      <QueueTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tickets={visibleTickets}
        userRole={userRole}
        userId={userId}
      />

      <div className="flex-1 flex overflow-hidden">
        <TicketTable
          tickets={filteredTickets}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectTicket={handleSelectTicket}
          selectedTicketId={selectedTicket?.id || null}
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
