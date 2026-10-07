import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { TicketDrawer } from '../components/TicketDrawer';
import {
  Ticket, UpdateLog, TicketStatus, UserRole,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, ROLE_LABELS, ROLE_BADGE_COLORS,
  getStatusLabel, getStatusColor, Priority,
} from '../types';
import {
  ActivityPeriod, ACTIVITY_PERIOD_LABELS, ActivityFilters, EMPTY_ACTIVITY_FILTERS, ActivityItem,
  getActivityWindow, buildActivityFeed, groupByDay, isStageChange,
} from '../lib/activity';

const PAGE = 1000; // PostgREST returns at most 1000 rows per request — page through all of them

async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function RecentActivityPage({ onBack }: { onBack: () => void }) {
  const { appUser } = useAuth();
  const [period, setPeriod] = useState<ActivityPeriod>('last_2_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [logs, setLogs] = useState<UpdateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);

  // The window the current data was loaded for (fixed at fetch time, so
  // "new tickets" and log entries cover exactly the same span).
  const [activityWindow, setActivityWindow] = useState(() => getActivityWindow('last_2_days'));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const w = getActivityWindow(period, customStart, customEnd);
      const [ticketRows, logRows] = await Promise.all([
        fetchAllPages<Ticket>((from, to) => supabase
          .from('tickets').select('*, reporter:app_users!reporter_id(*)')
          .order('created_at', { ascending: false }).order('id').range(from, to)),
        fetchAllPages<UpdateLog>((from, to) => supabase
          .from('update_logs').select('*, author:app_users!author_id(*)')
          .gte('created_at', w.start.toISOString()).lte('created_at', w.end.toISOString())
          .order('created_at', { ascending: false }).order('id').range(from, to)),
      ]);
      setTickets(ticketRows);
      setLogs(logRows);
      setActivityWindow(w);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load activity.');
    }
    setLoading(false);
  }, [period, customStart, customEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const role = (appUser?.role as UserRole) || UserRole.CS_MANAGER;
  const userId = appUser?.id || '';
  const { items, summary } = useMemo(
    () => buildActivityFeed(logs, tickets, activityWindow, role, userId, filters),
    [logs, tickets, activityWindow, role, userId, filters],
  );
  const days = useMemo(() => groupByDay(items), [items]);

  // People who wrote something (or created a ticket) in this window, for the filter
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of logs) if (l.author) m.set(l.author_id, l.author.full_name);
    for (const t of tickets) {
      if (t.reporter && new Date(t.created_at) >= activityWindow.start) m.set(t.reporter_id, t.reporter.full_name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [logs, tickets, activityWindow]);

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_ACTIVITY_FILTERS);
  const set = <K extends keyof ActivityFilters>(k: K, v: ActivityFilters[K]) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-500 hover:text-gray-700" aria-label="Back to dashboard">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Recent Activity</h1>
              <p className="text-xs text-gray-500">Every comment, update and stage change across the tickets you can see</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as ActivityPeriod)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Time period"
            >
              {(Object.keys(ACTIVITY_PERIOD_LABELS) as ActivityPeriod[]).map(p => (
                <option key={p} value={p}>{ACTIVITY_PERIOD_LABELS[p]}</option>
              ))}
            </select>
            {period === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-md text-sm" aria-label="From date" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-md text-sm" aria-label="To date" />
              </>
            )}
            <button onClick={fetchData} disabled={loading}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-[1100px] mx-auto space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={filters.search}
            onChange={e => set('search', e.target.value)}
            placeholder="Search ticket, lab, subject or comment…"
            className="flex-1 min-w-[220px] px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={filters.person} onChange={e => set('person', e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm" aria-label="Person">
            <option value="ALL">Everyone</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <input
            type="text"
            value={filters.clientId}
            onChange={e => set('clientId', e.target.value)}
            placeholder="Client ID"
            className="w-28 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={filters.onlyStageChanges} onChange={e => set('onlyStageChanges', e.target.checked)} />
            Only stage changes
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={filters.onlyMyTickets} onChange={e => set('onlyMyTickets', e.target.checked)} />
            Only my tickets
          </label>
          {filtersActive && (
            <button onClick={() => setFilters(EMPTY_ACTIVITY_FILTERS)} className="text-xs text-blue-600 hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Updates" value={summary.updates} />
          <SummaryCard label="Tickets touched" value={summary.ticketsTouched} />
          <SummaryCard label="New tickets" value={summary.newTickets} />
          <SummaryCard label="Stage changes" value={summary.stageChanges}
            sub={summary.movedTo.slice(0, 3).map(m => `${m.count} → ${m.label}`).join(' · ')} />
        </div>

        {error && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-sm">{error}</div>}

        {/* Feed */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 py-12 text-center text-sm text-gray-500">
            No activity in this period{filtersActive ? ' with these filters' : ''}.
          </div>
        ) : (
          <div className="space-y-5">
            {days.map(group => (
              <section key={group.day}>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {dayLabel(group.day)} <span className="font-normal normal-case">· {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}</span>
                </h2>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {group.items.map(item => (
                    <FeedRow key={item.kind === 'log' ? item.log.id : `created-${item.ticket.id}`} item={item} onOpen={setSelected} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <TicketDrawer
          ticket={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => { setSelected(null); fetchData(); }}
        />
      )}
    </div>
  );
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (isToday(d)) return `Today, ${format(d, 'd MMM')}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, 'd MMM')}`;
  return format(d, 'EEEE, d MMM yyyy');
}

function SummaryCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

function FeedRow({ item, onOpen }: { item: ActivityItem; onOpen: (t: Ticket) => void }) {
  const t = item.ticket;
  const time = format(new Date(item.at), 'HH:mm');
  const author = item.kind === 'log' ? item.log.author : t.reporter;
  const role = author?.role as UserRole | undefined;

  return (
    <button onClick={() => onOpen(t)} className="w-full text-left px-4 py-3 hover:bg-blue-50/40 transition-colors flex gap-4">
      <span className="text-xs text-gray-400 w-10 shrink-0 pt-0.5 tabular-nums">{time}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-mono text-xs text-blue-700 font-medium">{t.custom_id}</span>
          <span className="text-sm text-gray-900 font-medium truncate max-w-[340px]">{t.lab_name}</span>
          <span className="text-sm text-gray-500 truncate max-w-[360px]">{t.subject}</span>
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${PRIORITY_COLORS[t.priority as Priority]}`}>{t.priority}</span>
          <span className={`px-1.5 py-0.5 rounded text-[11px] ${getStatusColor(t)}`} title="Current stage">now: {getStatusLabel(t)}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-1 text-xs">
          <span className="font-medium text-gray-800">{author?.full_name || 'Unknown'}</span>
          {role && <span className={`px-1.5 py-0.5 rounded ${ROLE_BADGE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>}
          {item.kind === 'created' ? (
            <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Created ticket</span>
          ) : isStageChange(item.log) ? (
            <span className="text-gray-500">
              <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS[item.log.previous_status as TicketStatus]}`}>{STATUS_LABELS[item.log.previous_status as TicketStatus]}</span>
              <span className="mx-1">→</span>
              <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS[item.log.new_status as TicketStatus]}`}>{STATUS_LABELS[item.log.new_status as TicketStatus]}</span>
            </span>
          ) : (
            <span className="text-gray-400">commented</span>
          )}
          {item.kind === 'log' && item.log.hold_target_date && (
            <span className="text-orange-600">hold until {format(new Date(item.log.hold_target_date), 'dd MMM yyyy')}</span>
          )}
        </div>

        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words line-clamp-3">
          {item.kind === 'log' ? item.log.comment : (t.description || 'New escalation raised.')}
        </p>
      </div>
    </button>
  );
}
