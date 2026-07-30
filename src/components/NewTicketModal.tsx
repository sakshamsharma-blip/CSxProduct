import { useState } from 'react';
import { TicketSubType, Priority } from '../types';
import { useAuth } from '../hooks/useAuth';
import { createTicket } from '../lib/actions';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function NewTicketModal({ isOpen, onClose, onCreated }: NewTicketModalProps) {
  const { appUser } = useAuth();
  const [labName, setLabName] = useState('');
  const [clientId, setClientId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [subType, setSubType] = useState<TicketSubType>(TicketSubType.BUG);
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [freshdeskId, setFreshdeskId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appUser) return;

    setLoading(true);
    setError('');

    try {
      await createTicket({
        lab_name: labName.trim(),
        client_id: clientId.trim(),
        subject: subject.trim(),
        description: description.trim(),
        sub_type: subType,
        priority,
        freshdesk_id: freshdeskId.trim() || undefined,
        reporter_id: appUser.id,
      });
      // Reset form
      setLabName('');
      setClientId('');
      setSubject('');
      setDescription('');
      setSubType(TicketSubType.BUG);
      setPriority(Priority.MEDIUM);
      setFreshdeskId('');
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">New Escalation Request</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="labName" className="block text-sm font-medium text-gray-700 mb-1">
                Lab / Client Name <span className="text-red-500">*</span>
              </label>
              <input
                id="labName"
                type="text"
                value={labName}
                onChange={e => setLabName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                placeholder="e.g. HealthLab Diagnostics"
              />
            </div>

            <div>
              <label htmlFor="clientId" className="block text-sm font-medium text-gray-700 mb-1">
                Client ID <span className="text-red-500">*</span>
              </label>
              <input
                id="clientId"
                type="text"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                placeholder="e.g. CL-2045"
              />
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                placeholder="Brief issue title"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                placeholder="Detailed description of the issue..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="subType" className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="subType"
                  value={subType}
                  onChange={e => setSubType(e.target.value as TicketSubType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                >
                  <option value={TicketSubType.BUG}>Bug</option>
                  <option value={TicketSubType.ENHANCEMENT}>Enhancement</option>
                  <option value={TicketSubType.FEATURE_REQUEST}>Feature Request</option>
                  <option value={TicketSubType.BACKEND_CONFIG}>Backend Config</option>
                </select>
              </div>

              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">
                  Priority <span className="text-red-500">*</span>
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                >
                  <option value={Priority.LOW}>Low</option>
                  <option value={Priority.MEDIUM}>Medium</option>
                  <option value={Priority.HIGH}>High</option>
                  <option value={Priority.CRITICAL}>Critical</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="freshdeskId" className="block text-sm font-medium text-gray-700 mb-1">
                Freshdesk Ticket ID <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="freshdeskId"
                type="text"
                value={freshdeskId}
                onChange={e => setFreshdeskId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
                placeholder="e.g. FD-12345"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating...' : 'Create Request'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
