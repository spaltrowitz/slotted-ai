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

interface ParticipantSync {
  userId: string;
  displayName: string;
  synced: boolean;
  calendarConnected: boolean;
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
  const [participants, setParticipants] = useState<ParticipantSync[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const fetchGroupOverlaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/availability/group-overlap', {
        friendIds,
      });
      setSuggestions(data.suggestions || []);
      setOverlaps(data.overlaps || []);
      setParticipants(data.participants || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to find group availability');
    } finally {
      setLoading(false);
    }
  }, [friendIds]);

  useEffect(() => {
    fetchGroupOverlaps();
  }, [fetchGroupOverlaps]);

  const handleBook = async (slot: ScoredSlot) => {
    setBookingSlot(slot.start);
    try {
      const title = friendNames.length <= 2
        ? `Hangout with ${friendNames.join(' & ')}`
        : `Group hangout (${friendNames.length + 1} people)`;
      const { data } = await api.post('/meetups', {
        title,
        friendIds,
        startTime: slot.start,
        endTime: slot.end,
      });
      // Check for quota warning
      if (data.quotaWarning) {
        const proceed = window.confirm(data.quotaWarning.message);
        if (!proceed) {
          try { await api.patch(`/meetups/${data.id}/rsvp`, { rsvp: 'declined' }); } catch {}
          setBookingSlot(null);
          return;
        }
      }
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

  return (
    <div className="rounded-2xl border border-purple-200/60 bg-white shadow-lg overflow-hidden">
      {/* Header — purple gradient for groups */}
      <div className="flex items-center justify-between border-b border-purple-100 px-4 sm:px-5 py-4 bg-gradient-to-r from-purple-50/50 to-fuchsia-50/30">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-gray-900 truncate">
            👥 Group Availability ({friendNames.length + 1} people)
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Finding times that work for {friendNames.join(', ')} &amp; you
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-200 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Participant sync status */}
      {participants.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          {participants.map(p => (
            <span
              key={p.userId}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                p.synced
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : p.calendarConnected
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-gray-50 text-gray-500'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${
                p.synced ? 'bg-emerald-500' : p.calendarConnected ? 'bg-amber-400' : 'bg-gray-300'
              }`} />
              {p.displayName.split(' ')[0]}
              {p.synced ? '' : p.calendarConnected ? ' (syncing…)' : ' (no cal)'}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-purple-400 border-t-transparent" />
            <p className="mt-3 text-xs text-gray-400">Syncing {friendNames.length + 1} calendars &amp; finding overlaps…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-4xl">📅</span>
            <h4 className="mt-3 text-sm font-semibold text-gray-800">No common free times found</h4>
            <p className="mt-1.5 max-w-sm text-xs text-gray-400 leading-relaxed">
              All {friendNames.length + 1} people are busy for the next 2 weeks.
              Try reducing the group size or checking back later.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((slot, idx) => (
              <div
                key={slot.start}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  idx === 0
                    ? 'border-purple-200 bg-gradient-to-r from-purple-50/60 to-fuchsia-50/40 shadow-sm'
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
                      <span className="rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        Best match
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{slot.timeLabel}</p>
                  {slot.reasons.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {slot.reasons.slice(0, 3).map((r) => (
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
                        : 'bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white'
                    }`}
                  >
                    {bookingSlot === slot.start ? '...' : booked === slot.start ? 'Booked ✓' : 'Book it'}
                  </button>
                </div>
              </div>
            ))}

            <p className="pt-2 text-center text-[11px] text-gray-400">
              {overlaps.length} overlapping windows · Showing top {suggestions.length} for all {friendNames.length + 1} people
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-5 py-3 flex justify-between items-center">
        <p className="text-[11px] text-gray-400">Based on the next 2 weeks of all calendars</p>
        <button
          onClick={fetchGroupOverlaps}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
        >
          {loading ? 'Syncing…' : '🔄 Refresh'}
        </button>
      </div>
    </div>
  );
}
