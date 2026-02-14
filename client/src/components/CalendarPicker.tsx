import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface CalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole: string; // 'owner' | 'writer' | 'reader' | 'freeBusyReader'
  selected: boolean;
}

interface CalendarPickerProps {
  onClose?: () => void;
  compact?: boolean;
}

export default function CalendarPicker({ onClose, compact = false }: CalendarPickerProps) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calRes, selRes] = await Promise.all([
        api.get('/calendar/list'),
        api.get('/calendar/selected'),
      ]);
      const cals: CalendarInfo[] = calRes.data.calendars || [];
      const selected: string[] = selRes.data.selectedCalendarIds || [];
      setCalendars(cals);
      // If no selection saved yet, default to all owned calendars
      if (selected.length === 0) {
        setSelectedIds(new Set(cals.filter(c => c.accessRole === 'owner').map(c => c.id)));
      } else {
        setSelectedIds(new Set(selected));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load calendars');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const toggleCalendar = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setSaved(false);
  };

  const selectAll = () => {
    setSelectedIds(new Set(calendars.map(c => c.id)));
    setSaved(false);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/calendar/selected', {
        calendarIds: Array.from(selectedIds),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save calendar selection');
    } finally {
      setSaving(false);
    }
  };

  // Group calendars: owned, shared/subscribed
  const ownedCalendars = calendars.filter(c => c.accessRole === 'owner');
  const sharedCalendars = calendars.filter(c => c.accessRole !== 'owner');

  const CalendarRow = ({ cal }: { cal: CalendarInfo }) => (
    <label
      key={cal.id}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all ${
        selectedIds.has(cal.id)
          ? 'bg-gradient-to-r from-gray-50 to-gray-100/50'
          : 'hover:bg-gray-50/50'
      }`}
    >
      <input
        type="checkbox"
        checked={selectedIds.has(cal.id)}
        onChange={() => toggleCalendar(cal.id)}
        className="h-4 w-4 rounded border-gray-300 text-slotted-500 focus:ring-slotted-400"
      />
      <div
        className="h-3 w-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: cal.backgroundColor || '#4285f4' }}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${selectedIds.has(cal.id) ? 'text-gray-900' : 'text-gray-500'}`}>
          {cal.summary}
          {cal.primary && (
            <span className="ml-1.5 text-[10px] font-semibold text-slotted-500">PRIMARY</span>
          )}
        </p>
        {cal.description && (
          <p className="text-[11px] text-gray-400 truncate">{cal.description}</p>
        )}
      </div>
      <span className="text-[10px] font-medium text-gray-400 flex-shrink-0 capitalize">
        {cal.accessRole === 'owner' ? '' : cal.accessRole}
      </span>
    </label>
  );

  if (loading) {
    return (
      <div className={`${compact ? 'py-4' : 'rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm'}`}>
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-400">Loading calendars...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? '' : 'rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden'}>
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">📅 Choose Calendars</h3>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Select which calendars Slotted should read for availability
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mx-5 mt-3 rounded-xl border border-red-100 bg-red-50/50 px-4 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className={compact ? 'space-y-3' : 'px-5 py-4 space-y-4'}>
        {/* Quick actions */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">
            {selectedIds.size} of {calendars.length} selected
          </p>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-[11px] font-medium text-slotted-500 hover:text-slotted-600">
              Select all
            </button>
            <span className="text-gray-300">·</span>
            <button onClick={deselectAll} className="text-[11px] font-medium text-gray-400 hover:text-gray-600">
              None
            </button>
          </div>
        </div>

        {/* Owned calendars */}
        {ownedCalendars.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              My Calendars
            </p>
            <div className="space-y-0.5">
              {ownedCalendars.map(cal => <CalendarRow key={cal.id} cal={cal} />)}
            </div>
          </div>
        )}

        {/* Shared / subscribed calendars */}
        {sharedCalendars.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              Shared with Me
            </p>
            <div className="space-y-0.5">
              {sharedCalendars.map(cal => <CalendarRow key={cal.id} cal={cal} />)}
            </div>
          </div>
        )}

        {calendars.length === 0 && !error && (
          <p className="text-center text-sm text-gray-400 py-4">
            No calendars found. Make sure your Google Calendar has at least one calendar.
          </p>
        )}
      </div>

      {/* Save button */}
      <div className={`flex items-center justify-end gap-3 ${compact ? 'pt-3' : 'border-t border-gray-100 px-5 py-3'}`}>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 ${
            saved ? 'bg-emerald-500' : 'gradient-btn'
          }`}
        >
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Selection'}
        </button>
      </div>
    </div>
  );
}
