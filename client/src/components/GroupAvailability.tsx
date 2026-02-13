import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  reasons: string[];
  dayLabel: string;
  timeLabel: string;
}

interface ParticipantStatus {
  id: string;
  name: string;
  synced: boolean;
  freeSlots: number;
  calendarConnected: boolean;
}

interface GroupSyncStatus {
  me: { synced: boolean; freeSlots: number };
  participants: ParticipantStatus[];
}

interface GroupAvailabilityProps {
  friendIds: string[];
  friendNames: string[];
  onClose: () => void;
  onBook?: (slot: ScoredSlot) => void;
}

export default function GroupAvailability({ friendIds, friendNames, onClose, onBook }: GroupAvailabilityProps) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<ScoredSlot[]>([]);
  const [overlaps, setOverlaps] = useState<{ start: string; end: string }[]>([]);
  const [syncStatus, setSyncStatus] = useState<GroupSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const groupLabel = friendNames.join(' & ');

  const fetchOverlaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/availability/group-overlap', { friendIds });
      setSuggestions(data.suggestions || []);
      setOverlaps(data.overlaps || []);
      setSyncStatus(data.syncStatus || null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to find group availability');
    } finally {
      setLoading(false);
    }
  }, [friendIds]);

  useEffect(() => {
    fetchOverlaps();
  }, [fetchOverlaps]);

  const handleBook = async (slot: ScoredSlot) => {
    setBookingSlot(slot.start);
    try {
      await api.post('/meetups', {
        title: `Group hangout with ${groupLabel}`,
        friendIds,
        startTime: slot.start,
        endTime: slot.end,
      });
      setBooked(slot.start);
      onBook?.(slot);
      setTimeout(() => setBooked(null), 3000);
    } catch {
      // silent fail
    } finally {
      setBookingSlot(null);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-gray-500 bg-gray-50 border-gray-200';
  };

  const scoreEmoji = (score: number) => {
    if (score >= 80) return '🔥';
    if (score >= 65) return '👍';
    if (score >= 50) return '🤔';
    return '😐';
  };

  const statusBadge = (synced: boolean, connected: boolean, _name: string, freeSlots: number) => {
    if (synced) return { emoji: '✅', text: `${freeSlots} free blocks`, css: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (connected) return { emoji: '⚠️', text: 'Sync pending', css: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { emoji: '❌', text: 'Calendar not connected', css: 'bg-red-50 text-red-600 border-red-200' };
  };

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 bg-gradient-to-r from-purple-50/40 to-slotted-50/30">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900">
            👥 Group Availability — {groupLabel}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Best times when everyone is free, scored by AI
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Sync status banners */}
      {syncStatus && (
        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium ${
              syncStatus.me.synced ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              {syncStatus.me.synced ? '✅' : '⚠️'} You: {syncStatus.me.synced ? `${syncStatus.me.freeSlots} free blocks` : 'Not synced'}
            </span>
            {syncStatus.participants.map((p) => {
              const badge = statusBadge(p.synced, p.calendarConnected, p.name, p.freeSlots);
              return (
                <span key={p.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium border ${badge.css}`}>
                  {badge.emoji} {p.name}: {badge.text}
                </span>
              );
            })}
          </div>
          {syncStatus.participants.some((p) => !p.calendarConnected) && (
            <p className="text-[11px] text-gray-400">
              💡 Ask friends without connected calendars to set up Google Calendar in Settings for better group suggestions
            </p>
          )}
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-purple-400 border-t-transparent" />
            <p className="mt-3 text-xs text-gray-400">Syncing {friendNames.length + 1} calendars &amp; finding the best group times…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-4xl">📅</span>
            <h4 className="mt-3 text-sm font-semibold text-gray-800">No overlapping free times for the group</h4>
            <p className="mt-1.5 max-w-sm text-xs text-gray-400 leading-relaxed">
              {syncStatus?.participants.some((p) => !p.calendarConnected)
                ? "Some friends haven't connected their calendars yet. Nudge them to connect in Settings!"
                : "Everyone's calendars are packed for the next 2 weeks. Try adjusting schedules or check back later."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((slot, idx) => (
              <div
                key={slot.start}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  idx === 0
                    ? 'border-purple-200 bg-gradient-to-r from-purple-50/60 to-slotted-50/40 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                {/* Score badge */}
                <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border ${scoreColor(slot.score)}`}>
                  <span className="text-xs font-bold">{slot.score}</span>
                </div>

                {/* Time info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                    {idx === 0 && (
                      <span className="rounded-full bg-gradient-to-r from-purple-500 to-slotted-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        Best for everyone
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{slot.timeLabel}</p>
                  {slot.reasons.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {slot.reasons.slice(0, 4).map((r) => (
                        <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Score emoji + book button */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-lg">{scoreEmoji(slot.score)}</span>
                  <button
                    onClick={() => handleBook(slot)}
                    disabled={bookingSlot === slot.start}
                    className={`rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 ${
                      booked === slot.start
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gradient-to-r from-purple-500 to-slotted-500 text-white'
                    }`}
                  >
                    {bookingSlot === slot.start ? '...' : booked === slot.start ? 'Booked ✓' : 'Book it'}
                  </button>
                </div>
              </div>
            ))}

            <p className="pt-2 text-center text-[11px] text-gray-400">
              {overlaps.length} group-wide windows found · Showing top {suggestions.length} suggestions
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-5 py-3 flex justify-between items-center">
        <p className="text-[11px] text-gray-400">Based on the next 2 weeks of {friendNames.length + 1} calendars</p>
        <button
          onClick={fetchOverlaps}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
        >
          {loading ? 'Syncing…' : '🔄 Refresh'}
        </button>
      </div>
    </div>
  );
}
