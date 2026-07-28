import { QueueTab, Ticket, TicketStatus, UserRole } from '../types';
import { isHoldExpired } from '../hooks/useTickets';

interface QueueTabsProps {
  activeTab: QueueTab;
  onTabChange: (tab: QueueTab) => void;
  tickets: Ticket[];
  userRole: UserRole;
  userId: string;
}

interface TabDef {
  key: QueueTab;
  label: string;
  count: (tickets: Ticket[], userId?: string) => number;
  visibleTo: UserRole[]; // Which roles can see this tab
}

const ALL_ROLES = [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.PRODUCT_LEAD];

const TABS: TabDef[] = [
  {
    key: 'all',
    label: 'All Requests',
    count: (t) => t.length,
    visibleTo: ALL_ROLES,
  },
  {
    key: 'my_tickets',
    label: 'My Tickets',
    count: (t, userId) => t.filter(x => x.reporter_id === userId).length,
    visibleTo: [UserRole.CS_MANAGER, UserRole.CS_LEAD],
  },
  {
    key: 'pending_cs',
    label: 'Pending CS Triage',
    count: (t) => t.filter(x => x.status === TicketStatus.NEW_ESCALATION).length,
    visibleTo: [UserRole.CS_MANAGER, UserRole.CS_LEAD],
  },
  {
    key: 'pending_product',
    label: 'Pending Review',
    count: (t) => t.filter(x =>
      x.status === TicketStatus.PENDING_PROD_REVIEW ||
      (x.status === TicketStatus.ON_HOLD_UNTIL && isHoldExpired(x))
    ).length,
    visibleTo: ALL_ROLES,
  },
  {
    key: 'in_scope',
    label: 'In Product Scope',
    count: (t) => t.filter(x => x.status === TicketStatus.IN_PRODUCT_SCOPE).length,
    visibleTo: ALL_ROLES,
  },
  {
    key: 'on_hold',
    label: 'On Hold',
    count: (t) => t.filter(x =>
      x.status === TicketStatus.ON_HOLD_UNTIL &&
      x.hold_until_date &&
      new Date(x.hold_until_date) > new Date()
    ).length,
    visibleTo: ALL_ROLES,
  },
  {
    key: 'closed',
    label: 'Closed / Resolved',
    count: (t) => t.filter(x =>
      x.status === TicketStatus.RESOLVED_BY_CS || x.status === TicketStatus.RESOLVED
    ).length,
    visibleTo: ALL_ROLES,
  },
];

export function QueueTabs({ activeTab, onTabChange, tickets, userRole, userId }: QueueTabsProps) {
  const visibleTabs = TABS.filter(tab => tab.visibleTo.includes(userRole));

  return (
    <div className="border-b border-gray-200 bg-white px-4">
      <nav className="flex gap-1 overflow-x-auto" aria-label="Queue tabs">
        {visibleTabs.map(tab => {
          const count = tab.count(tickets, userId);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`
                px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                ${isActive
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {tab.label}
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
