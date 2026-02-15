import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface CalendarOption {
  id: string;
  name: string;
  color: string | null;
  source: 'google' | 'apple';
}

interface AddToCalendarModalProps {
  meetupId: string;
  meetupTitle: string;
  startTime: string;
  endTime: string;
  onClose: () => void;
  onAdded?: () => void;
}

export default function AddToCalendarModal({
  meetupId,
  meetupTitle,
  startTime,
  endTime,
  onClose,
  onAdded,
}: AddToCalendarModalProps) {
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [appleConnected, setAppleConnected] = useState(false);
  const [selectedCalId, setSelectedCalId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<'google' | 'apple' | 'ics'>('ics');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendars = useCallback(async () => {
    try {
      const { data } = await api.get(`/meetups/${meetupId}/writable-calendars`);
      setCalendars(data.calendars || []);
      setGoogleConnected(data.googleConnected);
      setAppleConnected(data.appleConnected);

      // Auto-select the first Google "primary" or first owned calendar
      const primary = (data.calendars || []).find((c: CalendarOption) => c.id === 'primary' || c.name === 'Primary');
      const firstGoogle = (data.calendars || []).find((c: CalendarOption) => c.source === 'google');
      const firstApple = (data.calendars || []).find((c: CalendarOption) => c.source === 'apple');
      const autoSelect = primary || firstGoogle || firstApple;

      if (autoSelect) {
        setSelectedCalId(autoSelect.id);
        setSelectedSource(autoSelect.source);
      } else {
        setSelectedSource('ics');
      }
    } catch {
      // If we can't fetch calendars, default to ICS
      setSelectedSource('ics');
    } finally {
      setLoading(false);
    }
  }, [meetupId]);

  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  const handleAdd = async () => {
    setAdding(true);
    setError(null);
    try {
      const { data } = await api.post(`/meetups/${meetupId}/add-to-calendar`, {
        calendarId: selectedCalId,
        source: selectedSource,
      });

      if (data.source === 'ics' && data.icsContent) {
        // Download the ICS file
        const blob = new Blob([data.icsContent], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename || 'event.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setAdded(true);
      onAdded?.();
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add to calendar');
    } finally {
      setAdding(false);
    }
  };

  const formatTime = (dt: string) => {
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      {/* Modal */}
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-100 bg-gradient-to-r from-slotted-50/50 to-purple-50/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900">📅 Add to Calendar</h3>
              <p className="mt-0.5 text-xs text-gray-500">Save this meetup to your calendar</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Event summary */}
        <div className="border-b border-gray-100 px-6 py-3 bg-gray-50/50">
          <p className="text-sm font-semibold text-gray-900">{meetupTitle}</p>
          <p className="text-xs text-gray-500">{formatTime(startTime)} → {formatTime(endTime)}</p>
        </div>

        {/* Calendar selection */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
              <p className="mt-2 text-xs text-gray-400">Loading your calendars…</p>
            </div>
          ) : added ? (
            <div className="flex flex-col items-center justify-center py-8">
              <span className="text-4xl">✅</span>
              <p className="mt-2 text-sm font-semibold text-emerald-700">Added to calendar!</p>
              <p className="mt-1 text-xs text-gray-400">
                {selectedSource === 'ics' ? 'ICS file downloaded — open it to add to your calendar' : 'Event created in your calendar'}
              </p>
            </div>
          ) : (
            <>
              {/* Google calendars */}
              {googleConnected && calendars.filter(c => c.source === 'google').length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Google Calendar</p>
                  <div className="space-y-1.5">
                    {calendars.filter(c => c.source === 'google').map((cal) => (
                      <button
                        key={cal.id}
                        onClick={() => { setSelectedCalId(cal.id); setSelectedSource('google'); }}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                          selectedCalId === cal.id && selectedSource === 'google'
                            ? 'border-slotted-300 bg-slotted-50/60 shadow-sm ring-1 ring-slotted-200/50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className="h-4 w-4 rounded-full border border-white shadow-sm flex-shrink-0"
                          style={{ backgroundColor: cal.color || '#4285f4' }}
                        />
                        <span className="text-sm text-gray-900 truncate">{cal.name}</span>
                        {selectedCalId === cal.id && selectedSource === 'google' && (
                          <svg className="ml-auto h-4 w-4 text-slotted-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Apple calendars */}
              {appleConnected && calendars.filter(c => c.source === 'apple').length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Apple Calendar</p>
                  <div className="space-y-1.5">
                    {calendars.filter(c => c.source === 'apple').map((cal) => (
                      <button
                        key={cal.id}
                        onClick={() => { setSelectedCalId(cal.id); setSelectedSource('apple'); }}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                          selectedCalId === cal.id && selectedSource === 'apple'
                            ? 'border-slotted-300 bg-slotted-50/60 shadow-sm ring-1 ring-slotted-200/50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="h-4 w-4 rounded-full bg-gradient-to-br from-red-400 to-orange-400 border border-white shadow-sm flex-shrink-0" />
                        <span className="text-sm text-gray-900 truncate">{cal.name}</span>
                        {selectedCalId === cal.id && selectedSource === 'apple' && (
                          <svg className="ml-auto h-4 w-4 text-slotted-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ICS download fallback — always available */}
              <div className="mb-4">
                {(googleConnected || appleConnected) && (
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Other</p>
                )}
                <button
                  onClick={() => { setSelectedCalId(null); setSelectedSource('ics'); }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                    selectedSource === 'ics'
                      ? 'border-slotted-300 bg-slotted-50/60 shadow-sm ring-1 ring-slotted-200/50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-base">📥</span>
                  <div>
                    <span className="text-sm text-gray-900">Download .ics file</span>
                    <p className="text-[10px] text-gray-400">Works with any calendar app</p>
                  </div>
                  {selectedSource === 'ics' && (
                    <svg className="ml-auto h-4 w-4 text-slotted-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Connect calendar prompt if nothing is connected */}
              {!googleConnected && !appleConnected && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs text-amber-700">
                    <span className="font-semibold">Tip:</span> Connect your Google or Apple calendar in{' '}
                    <a href="/settings" className="underline font-medium hover:text-amber-800">Settings</a>{' '}
                    to add events directly.
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !added && (
          <div className="border-t border-gray-100 px-6 py-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all"
            >
              Skip
            </button>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="rounded-xl gradient-btn px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
            >
              {adding
                ? 'Adding…'
                : selectedSource === 'ics'
                  ? '📥 Download .ics'
                  : selectedSource === 'google'
                    ? '📅 Add to Google Calendar'
                    : '🍎 Add to Apple Calendar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
