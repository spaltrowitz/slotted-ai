import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { getSmartDisplayName } from '../lib/utils';
import type { FriendRecord } from '../lib/queries';
import EventShowtimesPoll from './EventShowtimesPoll';
import EventAutocomplete from './EventAutocomplete';
import type { AutocompleteEvent } from './EventAutocomplete';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface EventSearchModalProps {
  friends: FriendRecord[];
  preselectedFriendIds?: string[];
  onClose: () => void;
}

export interface ScheduleShowtime {
  datetime: string;
  available: boolean;
  allFree: string[];
  conflicts: { name: string; reason: string }[];
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
  event: ScheduleEvent;
  showtimes: ScheduleShowtime[];
}

export default function EventSearchModal({
  friends,
  preselectedFriendIds = [],
  onClose,
}: EventSearchModalProps) {
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(
    new Set(preselectedFriendIds),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScheduleResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(true);

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const allFriendNames = friends.map((f) => f.friend.displayName);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const toggleFriend = (id: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAutocompleteSelect = async (event: AutocompleteEvent) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const { data } = await api.post<ScheduleResponse>('/events/schedule', {
        query: event.title,
        eventId: event.id,
        friendIds: Array.from(selectedFriendIds),
      });
      setResults(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to find events';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

    setError(null);
    try {
      const { data } = await api.post<ScheduleResponse>('/events/from-url', {
        friendIds: Array.from(selectedFriendIds),
      });
      setResults(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Could not extract event from that link';
      setError(message);
    } finally {
    }
  };

  if (results) {
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
              friendIds={Array.from(selectedFriendIds)}
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">🎟️ Find an event to go to</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Typeahead search */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1.5 block">
              What do you want to see?
            </label>
            <EventAutocomplete
              onSelect={handleAutocompleteSelect}
              inputRef={inputRef}
            />
          </div>

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
                          ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-300'
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
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-purple-500 text-[11px] font-bold text-white">
                          {f.friend.displayName?.[0]}
                        </span>
                      )}
                      {getSmartDisplayName(f.friend.displayName, allFriendNames)}
                      {isSelected && <span className="text-violet-500">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-400 border-t-transparent" />
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
                We'll find showtimes and check everyone's calendars ✨
              </p>
              <p className="text-[11px] text-gray-400">
                Friends not on Slotted? You can invite them after picking an event
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
