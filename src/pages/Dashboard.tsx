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
  onNavigateActivity: () => void;
  onChangePassword: () => void;
}

export function Dashboard({ onNavigateAnalytics, onNavigateUsers, onNavigateActivity, onChangePassword }: DashboardProps) {
  const { tickets, loading, refetch, holdExpiredCount, holdReturnedIds } = useTickets();
  const { appUser } = useAuth();
  const [activeTab, setActiveTab] = useState<QueueTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  // When set, the list shows only these tickets (e.g. "returned from hold")
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null);

  function changeTab(tab: QueueTab) {
    setOnlyIds(null);
    setActiveTab(tab);
  }

  // Clicking the "returned from hold" banner shows exactly those tickets
  function showHoldReturned() {
    setActiveTab('all');
    setOverdueOnly(false);
    setSearchQuery('');
    setOnlyIds(holdReturnedIds);
  }

  // Clicking a Duplicate badge lists every ticket sharing that Jira key
  function showDuplicates(jiraKey: string) {
    setOnlyIds(null);
    setActiveTab('all');
    setOverdueOnly(false);
    setSearchQuery(jiraKey);
  }

  // Clicking the overdue banner shows exactly those tickets
  function showOverdue() {
    setOnlyIds(null);
    setActiveTab('all');
    setOverdueOnly(true);
  }

  const userRole = (appUser?.role as UserRole) || UserRole.CS_MANAGER;
  const userId = appUser?.id || '';

  // First apply role-based visibility, then tab filter
  const visibleTickets = getVisibleTickets(tickets, userRole, userId);
  const tabTickets = filterTicketsByTab(visibleTickets, activeTab, userId);
  const filteredTickets = onlyIds ? tabTickets.filter(t => onlyIds.includes(t.id)) : tabTickets;

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
        onActivity={onNavigateActivity}
        onChangePassword={onChangePassword}
        onManageUsers={onNavigateUsers}
        currentPage="dashboard"
      />
      <QueueTabs
        activeTab={activeTab}
        onTabChange={changeTab}
        tickets={visibleTickets}
        userRole={userRole}
        userId={userId}
      />

      {/* Attention Banners — persist until the underlying issue is resolved */}
      {(holdExpiredCount > 0 || slaBreachCount > 0) && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-2.5 flex flex-wrap gap-4">
          {holdExpiredCount > 0 && (
            <button type="button" onClick={showHoldReturned}
              className="text-sm text-orange-800 text-left hover:underline focus:outline-none focus:ring-2 focus:ring-orange-400 rounded"
              title="Show only these tickets">
              <span className="font-semibold">⏰ {holdExpiredCount} ticket{holdExpiredCount > 1 ? 's' : ''}</span>
              {' '}returned from hold — moved to Pending Review.{' '}
              <span className="font-medium">{onlyIds ? 'Showing them below' : 'Show them →'}</span>
            </button>
          )}
          {slaBreachCount > 0 && (
            <button type="button" onClick={showOverdue}
              className="text-sm text-red-700 text-left hover:underline focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
              title="Show only these tickets">
              <span className="font-semibold">🔴 {slaBreachCount} ticket{slaBreachCount > 1 ? 's' : ''}</span>
              {' '}overdue for weekly update (7+ days without activity).{' '}
              <span className="font-medium">{overdueOnly ? 'Showing them below' : 'Show them →'}</span>
            </button>
          )}
        </div>
      )}

      {onlyIds && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-800 flex items-center gap-3">
          <span>Showing only the {onlyIds.length} ticket{onlyIds.length > 1 ? 's' : ''} returned from hold.</span>
          <button type="button" onClick={() => setOnlyIds(null)} className="font-medium underline hover:text-blue-900">Show all tickets</button>
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
          allTickets={tickets}
          onShowDuplicates={showDuplicates}
          overdueOnly={overdueOnly}
          onOverdueChange={setOverdueOnly}
        />
      </div>

      {/* Detail Drawer */}
      {selectedTicket && (
        <TicketDrawer
          ticket={selectedTicket}
          allTickets={tickets}
          onOpenTicket={handleSelectTicket}
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
