import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface CalendarInfo {
  calendar_id: string;
  calendar_name: string;
  calendar_color: string | null;
  access_role: string; // 'owner' | 'writer' | 'reader' | 'freeBusyReader'
  is_selected: boolean;
  source: 'google' | 'apple' | 'outlook';
}

interface CalendarPickerProps {
  source?: 'google' | 'apple' | 'outlook';
  onClose?: () => void;
  onSaved?: () => void;
  onDisconnected?: () => void;
  compact?: boolean;
}

export default function CalendarPicker({ source = 'google', onClose, onSaved, onDisconnected, compact = false }: CalendarPickerProps) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const saveDebounceRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const lastSavedSelectionRef = useRef('');
  const calendarsRef = useRef<CalendarInfo[]>([]);
  const { connectCalendar } = useAuth();

  const listEndpoint = source === 'apple' ? '/calendar/apple/list' : source === 'outlook' ? '/calendar/outlook/list' : '/calendar/list';

  const fetchCalendars = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsReconnect(false);
    try {
      const { data } = await api.get(listEndpoint);
      const loadedCalendars: CalendarInfo[] = data.calendars || [];
      setCalendars(loadedCalendars);
      lastSavedSelectionRef.current = loadedCalendars
        .filter((c) => c.is_selected)
        .map((c) => c.calendar_id)
        .sort()
        .join('|');
      hasLoadedRef.current = true;
    } catch (err: any) {
      const errCode = err.response?.data?.error;
      if (errCode === 'calendar_reconnect_required' || errCode === 'Calendar not connected') {
        setNeedsReconnect(true);
        setError('Your Google Calendar connection has expired. Please reconnect below.');
        // Clear stale "Connected" badge in parent
        localStorage.removeItem('slotted_google_calendar_connected');
        onDisconnected?.();
      } else {
        setError(errCode || 'Failed to load calendars');
      }
    } finally {
      setLoading(false);
    }
  }, [listEndpoint]);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  useEffect(() => {
    calendarsRef.current = calendars;
  }, [calendars]);

  const toggleCalendar = (calendarId: string) => {
    setCalendars(prev =>
      prev.map(c => c.calendar_id === calendarId ? { ...c, is_selected: !c.is_selected } : c)
    );
    setSaved(false);
  };

  const selectAll = () => {
    setCalendars(prev => prev.map(c => ({ ...c, is_selected: true })));
    setSaved(false);
  };

  const deselectAll = () => {
    setCalendars(prev => prev.map(c => ({ ...c, is_selected: false })));
    setSaved(false);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const calendarIds = calendars.filter(c => c.is_selected).map(c => c.calendar_id);
      await api.put('/calendar/selected', { calendarIds, source });
      lastSavedSelectionRef.current = [...calendarIds].sort().join('|');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save calendar selection');
    } finally {
      setSaving(false);
    }
  }, [calendars, onSaved, source]);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const selectedKey = calendars
      .filter((c) => c.is_selected)
      .map((c) => c.calendar_id)
      .sort()
      .join('|');
    if (selectedKey === lastSavedSelectionRef.current) return;
    if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = window.setTimeout(() => {
      void handleSave();
    }, 450);
    return () => {
      if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
    };
  }, [calendars, handleSave]);

  useEffect(() => {
    return () => {
      if (!hasLoadedRef.current) return;
      const calendarIds = calendarsRef.current.filter((c) => c.is_selected).map((c) => c.calendar_id);
      const selectedKey = [...calendarIds].sort().join('|');
      if (selectedKey === lastSavedSelectionRef.current) return;
      void api.put('/calendar/selected', { calendarIds, source })
        .then(() => {
          lastSavedSelectionRef.current = selectedKey;
        })
        .catch((err: any) => {
          console.error('Failed to save calendar selection on close:', err?.response?.data?.error || err?.message || err);
        });
    };
  }, [source]);

  const selectedCount = calendars.filter(c => c.is_selected).length;

  // Group calendars: owned, shared/subscribed
  const ownedCalendars = calendars.filter(c => c.access_role === 'owner');
  const sharedCalendars = calendars.filter(c => c.access_role !== 'owner');

  const CalendarRow = ({ cal }: { cal: CalendarInfo }) => (
    <label
      key={cal.calendar_id}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-all ${
        cal.is_selected
          ? 'bg-gradient-to-r from-gray-50 to-gray-100/50'
          : 'hover:bg-gray-50/50'
      }`}
    >
      <input
        type="checkbox"
        checked={cal.is_selected}
        onChange={() => toggleCalendar(cal.calendar_id)}
        className="h-4 w-4 rounded border-gray-300 text-slotted-500 focus:ring-slotted-400"
      />
      <div
        className="h-3 w-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: cal.calendar_color || '#4285f4' }}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${cal.is_selected ? 'text-gray-900' : 'text-gray-500'}`}>
          {cal.calendar_name}
        </p>
      </div>
      <span className="text-[10px] font-medium text-gray-400 flex-shrink-0 capitalize">
        {cal.access_role === 'owner' ? '' : cal.access_role}
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
      {!compact && !needsReconnect && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Choose Calendars</h3>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Select which calendars Slotted.ai should read for availability
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

      {needsReconnect && source === 'google' && (
        <div className="px-4 py-3">
          <button
            onClick={async () => {
              try {
                setNeedsReconnect(false);
                setError(null);
                await connectCalendar();
                await fetchCalendars();
              } catch {
                setNeedsReconnect(true);
                setError('Failed to reconnect. Please try again.');
              }
            }}
            className="w-full rounded-lg bg-slotted-500 px-4 py-2 text-xs font-semibold text-white hover:bg-slotted-600 transition-colors"
          >
            Reconnect Google Calendar
          </button>
        </div>
      )}

      {error && !needsReconnect && (
        <div className="mx-5 mt-3 rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
          <p>{error}</p>
        </div>
      )}

      {!needsReconnect && (
      <>
      <div className={compact ? 'space-y-3' : 'px-5 py-4 space-y-4'}>
        {/* Quick actions */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">
            {selectedCount} of {calendars.length} selected
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
              {ownedCalendars.map(cal => <CalendarRow key={cal.calendar_id} cal={cal} />)}
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
              {sharedCalendars.map(cal => <CalendarRow key={cal.calendar_id} cal={cal} />)}
            </div>
          </div>
        )}

        {calendars.length === 0 && !error && (
          <p className="text-center text-sm text-gray-400 py-4">
            No calendars found. Make sure your calendar has at least one calendar.
          </p>
        )}
      </div>

      {/* Save button */}
      <div className={`flex items-center justify-end gap-3 ${compact ? 'pt-3' : 'border-t border-gray-100 px-5 py-3'}`}>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            saved
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'border border-slotted-200 bg-slotted-50 text-slotted-700 hover:bg-slotted-100'
          }`}
        >
          {saving ? 'Saving...' : saved ? 'Calendars saved ✓' : 'Apply calendar selection'}
        </button>
      </div>
      </>
      )}
    </div>
  );
}
