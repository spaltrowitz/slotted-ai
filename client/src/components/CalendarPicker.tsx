import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface CalendarEntry {
  id: string;
  user_id: string;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string | null;
  is_selected: boolean;
  access_role: string | null;
}

interface CalendarPickerProps {
  /** Which calendar source to show: 'google' (default) or 'apple' */
  source?: 'google' | 'apple';
  /** Called when the user saves their selection */
  onSaved?: () => void;
}

export default function CalendarPicker({ source = 'google', onSaved }: CalendarPickerProps) {
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = source === 'apple' ? '/calendar/apple/list' : '/calendar/list';
      const { data } = await api.get(endpoint);
      setCalendars(data.calendars || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load calendars');
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const toggleCalendar = (calendarId: string) => {
    setCalendars((prev) =>
      prev.map((c) =>
        c.calendar_id === calendarId ? { ...c, is_selected: !c.is_selected } : c,
      ),
    );
    setSaved(false);
  };

  const selectAll = () => {
    setCalendars((prev) => prev.map((c) => ({ ...c, is_selected: true })));
    setSaved(false);
  };

  const deselectAll = () => {
    setCalendars((prev) => prev.map((c) => ({ ...c, is_selected: false })));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const selectedIds = calendars.filter((c) => c.is_selected).map((c) => c.calendar_id);
      await api.put('/calendar/selected', { calendarIds: selectedIds });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save selection');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = calendars.filter((c) => c.is_selected).length;

  if (loading) {
    return (
      <div className="mt-4 flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-3 border-teal-500 border-t-transparent" />
        <span className="ml-2 text-xs text-gray-400">Loading calendars…</span>
      </div>
    );
  }

  if (error && calendars.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
        {error}
      </div>
    );
  }

  if (calendars.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
        <p className="text-xs text-gray-500">No calendars found in your {source === 'apple' ? 'Apple' : 'Google'} account.</p>
      </div>
    );
  }

  // Group calendars by access role
  const ownedCalendars = calendars.filter((c) => c.access_role === 'owner');
  const otherCalendars = calendars.filter((c) => c.access_role !== 'owner');

  return (
    <div className="mt-4 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-600">
          Select which calendars Slotted should check for availability
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={selectAll}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 transition-all"
          >
            All
          </button>
          <button
            onClick={deselectAll}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 transition-all"
          >
            None
          </button>
        </div>
      </div>

      {/* Owned calendars */}
      {ownedCalendars.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Your calendars
          </p>
          <div className="space-y-1.5">
            {ownedCalendars.map((cal) => (
              <CalendarRow key={cal.calendar_id} calendar={cal} onToggle={toggleCalendar} />
            ))}
          </div>
        </div>
      )}

      {/* Other / shared calendars */}
      {otherCalendars.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Shared &amp; subscribed
          </p>
          <div className="space-y-1.5">
            {otherCalendars.map((cal) => (
              <CalendarRow key={cal.calendar_id} calendar={cal} onToggle={toggleCalendar} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 text-[11px] text-red-600">
          {error}
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-gray-400">
          {selectedCount} of {calendars.length} calendar{calendars.length !== 1 ? 's' : ''} selected
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed ${
            saved ? 'bg-emerald-500' : 'gradient-btn'
          }`}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Selection'}
        </button>
      </div>
    </div>
  );
}

/** Individual calendar row with toggle */
function CalendarRow({
  calendar,
  onToggle,
}: {
  calendar: CalendarEntry;
  onToggle: (calendarId: string) => void;
}) {
  const roleLabel =
    calendar.access_role === 'owner'
      ? null
      : calendar.access_role === 'writer'
        ? 'Editor'
        : calendar.access_role === 'reader'
          ? 'Viewer'
          : calendar.access_role === 'freeBusyReader'
            ? 'Free/Busy'
            : null;

  return (
    <button
      onClick={() => onToggle(calendar.calendar_id)}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
        calendar.is_selected
          ? 'border-slotted-300 bg-gradient-to-r from-slotted-50/60 to-purple-50/40 shadow-sm'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
      }`}
    >
      {/* Color dot */}
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-white shadow-sm"
        style={{ backgroundColor: calendar.calendar_color || '#4285f4' }}
      />

      {/* Name & role */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${calendar.is_selected ? 'text-gray-900' : 'text-gray-700'}`}>
          {calendar.calendar_name}
        </p>
        {roleLabel && (
          <p className="text-[11px] text-gray-400">{roleLabel}</p>
        )}
      </div>

      {/* Checkbox */}
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
          calendar.is_selected
            ? 'border-slotted-500 bg-slotted-500'
            : 'border-gray-300'
        }`}
      >
        {calendar.is_selected && (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </button>
  );
}
