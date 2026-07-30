import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import { supabase } from '../lib/supabase';
import { Ticket, UpdateLog, TicketStatus, Priority } from '../types';
import {
  TimePeriod, getDateRange, filterByDateRange, computeStatCards,
  getTypeDistribution, getPriorityDistribution, getStatusPipeline,
  getRaisedVsResolved, getTopClients, getCSMWorkload, getOldestOpen, formatTAT, ClientStat
} from '../lib/analytics';
import { getDaysSinceCreated } from '../hooks/useTickets';

// Built around the CrelioHealth green/blue pair, with neutrals filling out the series.
const BRAND_GREEN = '#3BA935';
const BRAND_BLUE = '#1A73E8';
const PIE_COLORS = [BRAND_GREEN, BRAND_BLUE, '#7FC878', '#8FB6F6', '#F59E0B', '#9CA3AF'];
const PRIORITY_BAR_COLORS: Record<string, string> = {
  CRITICAL: '#DC2626',
  HIGH: '#F97316',
  MEDIUM: BRAND_BLUE,
  LOW: '#9CA3AF',
};

export function AnalyticsPage({ onBack }: { onBack: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [logs, setLogs] = useState<UpdateLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('all_time');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientStat | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [ticketRes, logRes] = await Promise.all([
      supabase.from('tickets').select('*, reporter:app_users!reporter_id(*)').order('created_at', { ascending: false }),
      supabase.from('update_logs').select('*, author:app_users!author_id(*)').order('created_at', { ascending: true }),
    ]);
    if (ticketRes.data) setTickets(ticketRes.data as Ticket[]);
    if (logRes.data) setLogs(logRes.data as UpdateLog[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const dateRange = getDateRange(period, customStart, customEnd);
  const filteredTickets = filterByDateRange(tickets, dateRange);
  const stats = computeStatCards(filteredTickets, tickets, logs);
  const typeData = getTypeDistribution(filteredTickets);
  const priorityData = getPriorityDistribution(filteredTickets);
  const pipelineData = getStatusPipeline(tickets); // Always show current state
  const trendData = getRaisedVsResolved(filteredTickets, logs);
  const topClients = getTopClients(filteredTickets, logs);
  const csmWorkload = getCSMWorkload(filteredTickets);
  const oldestOpen = getOldestOpen(tickets);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-gray-900">Analytics Dashboard</h1>
          </div>

          {/* Time Period Filter */}
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as TimePeriod)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="this_week">This Week</option>
              <option value="mtd">Month to Date</option>
              <option value="ytd">Year to Date</option>
              <option value="all_time">All Time</option>
              <option value="custom">Custom Range</option>
            </select>
            {period === 'custom' && (
              <>
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-md text-sm"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-2 border border-gray-300 rounded-md text-sm"
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Raised" value={stats.totalRaised} />
          <StatCard label="Currently Open" value={stats.currentlyOpen} color="text-blue-600" />
          <StatCard label="Closed" value={stats.closed} color="text-green-600" />
          <StatCard label="Reopen Rate" value={`${stats.reopenRate}%`} color={stats.reopenRate > 20 ? 'text-red-600' : 'text-gray-700'} />
          <StatCard label="Avg Resolution TAT" value={formatTAT(stats.avgResolutionTAT)} sublabel="In Scope → Resolved" />
          <StatCard label="Avg Closure TAT" value={formatTAT(stats.avgClosureTAT)} sublabel="Resolved → Closed" />
          <StatCard label="Avg End-to-End" value={formatTAT(stats.avgEndToEndTAT)} sublabel="Created → Closed" />
          <StatCard label="SLA Breaches" value={stats.slaBreaches} color={stats.slaBreaches > 0 ? 'text-red-600' : 'text-green-600'} />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tickets by Type */}
          <ChartCard title="Tickets by Type">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                  {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Tickets by Priority */}
          <ChartCard title="Tickets by Priority">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name="Tickets">
                  {priorityData.map((entry, i) => (
                    <Cell key={i} fill={PRIORITY_BAR_COLORS[entry.name] || BRAND_BLUE} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Raised vs Resolved Trend */}
          <ChartCard title="Raised vs Resolved (Monthly)">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="raised" stroke={BRAND_BLUE} strokeWidth={2} name="Raised" />
                <Line type="monotone" dataKey="resolved" stroke={BRAND_GREEN} strokeWidth={2} name="Resolved" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Status Pipeline */}
          <ChartCard title="Current Status Pipeline">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={pipelineData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis type="category" dataKey="name" fontSize={11} width={120} />
                <Tooltip />
                <Bar dataKey="value" fill={BRAND_BLUE} name="Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* CSM Workload */}
        <ChartCard title="CSM Workload (Tickets by Reporter & Type)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={csmWorkload}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="bugs" stackId="a" fill="#DC2626" name="Bugs" />
              <Bar dataKey="enhancements" stackId="a" fill="#F59E0B" name="Enhancements" />
              <Bar dataKey="features" stackId="a" fill={BRAND_BLUE} name="Features" />
              <Bar dataKey="configs" stackId="a" fill={BRAND_GREEN} name="Config" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Clients + Client Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Clients */}
          <ChartCard title="Top Clients by Volume">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {topClients.slice(0, 15).map((client, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedClient(client)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm hover:bg-blue-50 transition-colors ${
                    selectedClient?.clientId === client.clientId ? 'bg-blue-50 border border-blue-200' : ''
                  }`}
                >
                  <div className="text-left">
                    <span className="font-medium text-gray-900">{client.clientName}</span>
                    <span className="text-xs text-gray-400 ml-2">{client.clientId}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{client.open} open</span>
                    <span className="text-xs text-green-600">{client.closed} closed</span>
                    <span className="font-semibold text-gray-700">{client.total}</span>
                  </div>
                </button>
              ))}
              {topClients.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No client data yet.</p>}
            </div>
          </ChartCard>

          {/* Client Detail */}
          <ChartCard title={selectedClient ? `Client: ${selectedClient.clientName}` : 'Select a Client'}>
            {selectedClient ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Total Raised" value={selectedClient.total} />
                  <MiniStat label="Open" value={selectedClient.open} />
                  <MiniStat label="Closed" value={selectedClient.closed} />
                  <MiniStat label="Reopened" value={selectedClient.reopenCount} />
                  <MiniStat label="Avg TAT" value={formatTAT(selectedClient.avgTAT)} />
                  <MiniStat label="SLA Breaches" value={selectedClient.slaBreaches} />
                </div>
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">By Type</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedClient.byType).map(([type, count]) => (
                      <span key={type} className="px-2 py-1 bg-gray-100 rounded text-xs">
                        {type.replace('_', ' ')}: {count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">By Priority</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedClient.byPriority).map(([p, count]) => (
                      <span key={p} className="px-2 py-1 bg-gray-100 rounded text-xs">
                        {p}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Click a client from the list to see detailed breakdown.</p>
            )}
          </ChartCard>
        </div>

        {/* Drill-Down Tables */}
        <div className="grid grid-cols-1 gap-6">
          {/* Oldest Open Tickets */}
          <ChartCard title="Oldest Open Tickets (Attention Needed)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">ID</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Client</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Subject</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Priority</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Status</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {oldestOpen.map(t => (
                    <tr key={t.id} className="border-b border-gray-100">
                      <td className="py-2 px-3 font-mono text-xs">{t.custom_id}</td>
                      <td className="py-2 px-3 text-xs">{t.lab_name}</td>
                      <td className="py-2 px-3 text-xs max-w-[200px] truncate">{t.subject}</td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          t.priority === Priority.CRITICAL ? 'bg-red-100 text-red-700' :
                          t.priority === Priority.HIGH ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{t.priority}</span>
                      </td>
                      <td className="py-2 px-3 text-xs">{t.status.replace(/_/g, ' ')}</td>
                      <td className="py-2 px-3 text-xs font-medium text-red-600">{getDaysSinceCreated(t)}d</td>
                    </tr>
                  ))}
                  {oldestOpen.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-gray-400 text-xs">No open tickets.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ===== Sub-components =====

function StatCard({ label, value, sublabel, color }: { label: string; value: string | number; sublabel?: string; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</p>
      {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
