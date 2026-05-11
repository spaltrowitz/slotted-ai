import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../lib/api';
import { getSmartDisplayName } from '../lib/utils';
import type { FriendRecord } from '../lib/queries';
import EventShowtimesPoll from './EventShowtimesPoll';
import EventAutocomplete from './EventAutocomplete';
import type { AutocompleteEvent } from './EventAutocomplete';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type TimeframeMode = 'all' | 'specific';
type EventModalMode = 'search' | 'browse';
type DateWindow = { start: string; end: string };

interface EventSearchModalProps {
  friends: FriendRecord[];
  preselectedFriendIds?: string[];
  initialMode?: EventModalMode;
  onClose: () => void;
}

export interface ScheduleShowtime {
  datetime: string;
  available: boolean;
  availabilityState: 'all_clear' | 'some_busy' | 'check_incomplete';
  totalParticipants: number;
  busyCount: number;
  checkFailedCount: number;
  ticketUrl: string;
  price?: { min?: number | null; max?: number | null } | null;
}

export interface ScheduleEvent {
  id?: string;
  title: string;
  venue: string;
  imageUrl?: string;
}

export interface ScheduleResponse {
  event: ScheduleEvent | null;
  showtimes: ScheduleShowtime[];
  message?: string;
}

interface BrowseEvent {
  id: string;
  title: string;
  venue: string;
  type: string;
  datetime: string;
  datetimeLocal: string;
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
}

interface BrowseResponse {
  events: BrowseEvent[];
  message?: string;
}

export default function EventSearchModal({
  friends,
  preselectedFriendIds = [],
  initialMode = 'search',
  onClose,
}: EventSearchModalProps) {
  const [mode, setMode] = useState<EventModalMode>(initialMode);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(
    new Set(preselectedFriendIds),
  );
  const [loading, setLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScheduleResponse | null>(null);
  const [draftEventKey, setDraftEventKey] = useState<string | null>(null);
  const [draftScheduleId, setDraftScheduleId] = useState<string | undefined>();
  const [selectedShowtimeDatetimes, setSelectedShowtimeDatetimes] = useState<Set<string>>(new Set());
  const [browseResults, setBrowseResults] = useState<BrowseEvent[]>([]);
  const [timeframeMode, setTimeframeMode] = useState<TimeframeMode>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateWindows, setDateWindows] = useState<DateWindow[]>([]);
  const [category, setCategory] = useState('events');
  const [eventQuery, setEventQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(true);

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const allFriendNames = friends.map((f) => f.friend.displayName);
  const today = new Date().toISOString().split('T')[0];
  const selectedFriendIdList = useMemo(() => Array.from(selectedFriendIds), [selectedFriendIds]);
  const selectedFriendNames = useMemo(
    () => acceptedFriends
      .filter((f) => selectedFriendIds.has(f.friend.id))
      .map((f) => f.friend.displayName),
    [acceptedFriends, selectedFriendIds],
  );

  const getEventKey = (event: ScheduleEvent) => (
    event.id ?? `${event.title.trim().toLowerCase()}::${event.venue.trim().toLowerCase()}`
  );

  const clearBrowseResults = () => {
    setBrowseResults([]);
    setError(null);
  };

  const getDateWindows = () => {
    if (timeframeMode !== 'specific') return [];
    const windows = [...dateWindows];
    if (dateFrom && dateTo) {
      windows.push({ start: dateFrom, end: dateTo });
    }
    return windows;
  };

  const getValidatedDateWindows = (action: 'searching' | 'browsing') => {
    if (timeframeMode !== 'specific') return [];

    const hasPartialWindow = Boolean(dateFrom) !== Boolean(dateTo);
    if (hasPartialWindow) {
      setError(`Choose both From and To dates before ${action}.`);
      return null;
    }

    if (dateFrom && dateTo && dateTo < dateFrom) {
      setError('End date must be on or after start date.');
      return null;
    }

    const windows = getDateWindows();
    if (windows.length === 0) {
      setError(`Choose at least one date window before ${action}.`);
      return null;
    }

    return windows;
  };

  const addDateWindow = () => {
    if (!dateFrom || !dateTo) {
      setError('Choose both dates before adding that window.');
      return;
    }
    if (dateTo < dateFrom) {
      setError('End date must be on or after start date.');
      return;
    }
    setDateWindows((prev) => [...prev, { start: dateFrom, end: dateTo }]);
    setDateFrom('');
    setDateTo('');
    clearBrowseResults();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const toggleFriend = (id: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const searchEvent = async (query: string, eventId?: string) => {
    const windows = getValidatedDateWindows('searching');
    if (!windows) {
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const { data } = await api.post<ScheduleResponse>('/events/schedule', {
        query,
        eventId,
        friendIds: selectedFriendIdList,
        dateRanges: timeframeMode === 'specific' ? windows : undefined,
        dateRange: timeframeMode === 'specific' ? undefined : { start: today, end: null },
      });
      if (!data.event || data.showtimes.length === 0) {
        setError(data.message ?? 'No upcoming showtimes found for that search.');
        return;
      }
      const nextEventKey = getEventKey(data.event);
      if (draftEventKey !== nextEventKey) {
        setDraftScheduleId(undefined);
        setSelectedShowtimeDatetimes(new Set());
      }
      setDraftEventKey(nextEventKey);
      setResults(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to find events';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleEventQueryChange = (value: string) => {
    setEventQuery(value);
    setSelectedEventId(undefined);
  };

  const handleAutocompleteSelect = (event: AutocompleteEvent) => {
    setEventQuery(event.title);
    setSelectedEventId(event.id);
  };

  const getDateRange = () => {
    const end = new Date();
    end.setMonth(end.getMonth() + 6);
    return { start: today, end: end.toISOString().split('T')[0] };
  };

  const browseEvents = async () => {
    const windows = getValidatedDateWindows('browsing');
    if (!windows) {
      return;
    }

    setBrowseLoading(true);
    setError(null);
    setBrowseResults([]);
    try {
      const ranges = timeframeMode === 'specific' ? windows : [getDateRange()];
      const responses = await Promise.all(
        ranges.map((range) => api.get<BrowseResponse>('/events/discover', {
          params: {
            type: category === 'events' ? undefined : category,
            dateFrom: range.start,
            dateTo: range.end,
            perPage: 12,
          },
        })),
      );
      const seen = new Set<string>();
      const events = responses
        .flatMap((resp) => resp.data.events ?? [])
        .filter((event) => {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        })
        .slice(0, 12);
      setBrowseResults(events);
      if (!events.length) {
        setError(responses[0]?.data.message ?? 'No events found for that timeframe.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to browse events');
    } finally {
      setBrowseLoading(false);
    }
  };

  const findShowtimes = () => {
    const trimmedQuery = eventQuery.trim();
    if (trimmedQuery.length < 2) {
      setError('Enter an event name before searching.');
      return;
    }
    void searchEvent(trimmedQuery, selectedEventId);
  };

  if (results && results.event) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
        role="dialog"
        aria-modal="true"
        aria-label="Event showtimes"
      >
        <div className="w-full max-h-[85dvh] sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <button
              onClick={() => setResults(null)}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Back
            </button>
            <h2 className="text-sm font-semibold text-gray-900 truncate px-2">
              {results.event.title}
            </h2>
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EventShowtimesPoll
              event={results.event}
              showtimes={results.showtimes}
              friendIds={selectedFriendIdList}
              friendNames={selectedFriendNames}
              initialEventScheduleId={draftScheduleId}
              initialSelectedDatetimes={selectedShowtimeDatetimes}
              onDraftSaved={setDraftScheduleId}
              onSelectionChange={setSelectedShowtimeDatetimes}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Plan an event"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            🎟️ {mode === 'search' ? 'Find a specific event' : 'Browse event ideas'}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              { mode: 'browse' as const, label: 'Browse ideas' },
              { mode: 'search' as const, label: 'Search by name' },
            ].map((option) => {
              const selected = mode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => {
                    setMode(option.mode);
                    clearBrowseResults();
                  }}
                  className={`min-h-[44px] rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                    selected
                      ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Typeahead search */}
          {mode === 'search' && (
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">
              What do you want to see?
            </label>
            <EventAutocomplete
              value={eventQuery}
              onChange={handleEventQueryChange}
              onSelect={handleAutocompleteSelect}
              inputRef={inputRef}
            />
          </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-gray-500">
                Dates <span className="font-normal text-gray-400">(optional)</span>
              </label>
              {timeframeMode === 'specific' && (
                <button
                  type="button"
                  onClick={() => {
                    setTimeframeMode('all');
                    setDateFrom('');
                    setDateTo('');
                    setDateWindows([]);
                    clearBrowseResults();
                  }}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Search all dates
                </button>
              )}
            </div>
            {timeframeMode === 'specific' ? (
              <div className="space-y-2">
                {dateWindows.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {dateWindows.map((window, index) => (
                      <button
                        key={`${window.start}-${window.end}-${index}`}
                        type="button"
                        onClick={() => {
                          setDateWindows((prev) => prev.filter((_, i) => i !== index));
                          clearBrowseResults();
                        }}
                        className="min-h-[36px] rounded-full bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200"
                      >
                        {window.start}–{window.end} ✕
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    min={today}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      if (dateTo && e.target.value > dateTo) setDateTo('');
                      clearBrowseResults();
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom || today}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      clearBrowseResults();
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                </div>
                <button
                  type="button"
                  onClick={addDateWindow}
                  className="min-h-[44px] w-full rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-100"
                >
                  Add another date window
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs leading-relaxed text-gray-500">
                  Leave dates blank to search upcoming performances. Add specific dates to narrow the results.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTimeframeMode('specific');
                    clearBrowseResults();
                  }}
                  className="mt-2 min-h-[44px] w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-50"
                >
                  Add specific dates
                </button>
              </div>
            )}
          </div>

          {mode === 'browse' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">
                  What kind of event?
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[
                    { value: 'events', label: 'Anything' },
                    { value: 'theater', label: 'Theater' },
                    { value: 'concert', label: 'Concerts' },
                    { value: 'comedy', label: 'Comedy' },
                    { value: 'sports', label: 'Sports' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setCategory(option.value);
                        clearBrowseResults();
                      }}
                      className={`min-h-[44px] shrink-0 rounded-full px-3 text-xs font-semibold transition-all ${
                        category === option.value
                          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={browseEvents}
                disabled={browseLoading}
                className="min-h-[44px] w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {browseLoading ? 'Finding events…' : 'Browse events'}
              </button>
              {browseLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-14 animate-pulse rounded-xl bg-gray-100" />
                  ))}
                </div>
              ) : browseResults.length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {browseResults.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => searchEvent(event.title)}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-2.5 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/40"
                    >
                      {event.imageUrl ? (
                        <img src={event.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-lg">🎟️</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{event.title}</p>
                        {(event.venue || event.priceMin) && (
                          <p className="truncate text-xs text-gray-500">
                            {event.venue}
                            {event.priceMin ? `${event.venue ? ' · ' : ''}$${event.priceMin}${event.priceMax && event.priceMax !== event.priceMin ? `-${event.priceMax}` : ''}` : ''}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Friend selector */}
          {acceptedFriends.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-2 block">
                Who's coming? <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {acceptedFriends.map((f) => {
                  const isSelected = selectedFriendIds.has(f.friend.id);
                  return (
                    <button
                      key={f.friend.id}
                      onClick={() => toggleFriend(f.friend.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {f.friend.photoUrl ? (
                        <img
                          src={f.friend.photoUrl}
                          alt=""
                          className="h-4 w-4 rounded-full"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-[11px] font-bold text-white">
                          {f.friend.displayName?.[0]}
                        </span>
                      )}
                      {getSmartDisplayName(f.friend.displayName, allFriendNames)}
                      {isSelected && <span className="text-indigo-500">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === 'search' && (
            <button
              type="button"
              onClick={findShowtimes}
              disabled={loading || eventQuery.trim().length < 2}
              className="min-h-[44px] w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Finding showtimes…' : 'Continue to showtimes'}
            </button>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-t-transparent" />
              <p className="text-sm text-gray-500">
                Finding showtimes & checking calendars…
              </p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Empty hint */}
          {!loading && !error && (
            <div className="text-center pt-2 space-y-2">
              <p className="text-xs text-gray-500">
                We'll find showtimes and check everyone's calendars.
              </p>
              <p className="text-[11px] text-gray-400">
                Friends not on Slotted yet 😉? You can invite them after picking an event
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
