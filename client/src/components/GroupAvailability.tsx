import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { trackMeetupScheduled } from '../lib/analytics';
import { getSmartDisplayName } from '../lib/utils';
import AddToCalendarModal from './AddToCalendarModal';

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
  allFriendNames?: string[];
  onClose: () => void;
  onBook?: (slot: ScoredSlot) => void;
}

export default function GroupAvailability({ friendIds, friendNames, allFriendNames = [], onClose, onBook }: GroupAvailabilityProps) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<ScoredSlot[]>([]);
  const [overlaps, setOverlaps] = useState<{ start: string; end: string }[]>([]);
  const [participants, setParticipants] = useState<ParticipantSync[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [bookedLabel, setBookedLabel] = useState<{ day: string; time: string; title: string } | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  const fetchGroupOverlaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/availability/multi-friend-overlap', {
        friendIds,
      });
      setSuggestions(data.suggestions || []);
      setOverlaps(data.overlaps || []);
      setParticipants(data.participants || []);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      setError(axiosErr.response?.data?.error || axiosErr.message || 'Failed to find group availability');
    } finally {
      setLoading(false);
    }
  }, [friendIds]);

  useEffect(() => {
    fetchGroupOverlaps();
  }, [fetchGroupOverlaps]);

  const handleBook = async (slot: ScoredSlot) => {
    // Validate: don't allow booking past times
    if (new Date(slot.start) <= new Date()) {
      setBookError("Pick a time that hasn't happened yet 😊");
      setTimeout(() => setBookError(null), 4000);
      return;
    }
    if (new Date(slot.end) <= new Date(slot.start)) {
      setBookError("End time must be after start time");
      setTimeout(() => setBookError(null), 4000);
      return;
    }
    setBookingSlot(slot.start);
    setBookError(null);
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
      trackMeetupScheduled();
      // Check for quota warning
      if (data.quotaWarning) {
        const proceed = window.confirm(data.quotaWarning.message);
        if (!proceed) {
          try { await api.patch(`/meetups/${data.id}/rsvp`, { rsvp: 'declined' }); } catch {}
          setBookingSlot(null);
          return;
        }
      }
      setBookingSlot(null);
      const bookedSlot = suggestions.find(s => s.start === slot.start);
      setBookedLabel({
        day: bookedSlot?.dayLabel || '',
        time: bookedSlot?.timeLabel || '',
        title,
      });
      setBooked(slot.start);
      onBook?.(slot);
    } catch (err: unknown) {
      setBookingSlot(null);
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      setBookError(axiosErr.response?.data?.error || axiosErr.message || 'Failed to book — please try again');
      setTimeout(() => setBookError(null), 4000);
    }
  };


  return (
    <div className="rounded-2xl border border-purple-200/60 bg-white shadow-lg overflow-hidden">
      {/* Header — purple gradient for groups */}
      <div className="flex items-center justify-between border-b border-purple-100 px-4 sm:px-5 py-4 bg-gradient-to-r from-purple-50/50 to-fuchsia-50/30">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-gray-900 truncate">
            Group Availability ({friendNames.length + 1} people)
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
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
              {getSmartDisplayName(p.displayName, allFriendNames.length > 0 ? allFriendNames : friendNames)}
              {p.synced ? '' : p.calendarConnected ? ' (syncing…)' : ' (no cal)'}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-4">
        {booked && bookedLabel ? (
          /* ──── REQUEST SENT — full panel "what happens next" ──── */
          <div className="flex flex-col items-center text-center py-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
              <span className="text-3xl">📩</span>
            </div>
            <h3 className="font-display text-lg font-bold text-gray-900">Request Sent!</h3>
            <p className="mt-1 text-sm text-gray-500">{bookedLabel.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{bookedLabel.day} · {bookedLabel.time}</p>

            <div className="mt-5 w-full max-w-xs space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">What happens next</h4>
              <div className="space-y-2.5 text-left">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs">1</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{friendNames.join(' & ')} get notified</p>
                    <p className="text-[11px] text-gray-500">They'll see the invite in their Slotted.ai notifications</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs">2</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Everyone accepts or declines</p>
                    <p className="text-[11px] text-gray-500">Each person will see accept/decline on their Dashboard</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs">3</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Once confirmed, add to calendar</p>
                    <p className="text-[11px] text-gray-500">When everyone says yes, you'll all be prompted to add it to your calendars</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-xl border border-slotted-200 bg-slotted-50/50 px-4 py-2.5">
              <span className="text-sm">👀</span>
              <p className="text-xs text-slotted-700">Track this on your <a href="/" className="font-semibold underline underline-offset-2">Dashboard</a> under <strong>Pending</strong></p>
            </div>

            <button
              onClick={onClose}
              className="mt-4 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all"
            >
              Done
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-purple-400 border-t-transparent" />
            <p className="mt-3 text-xs text-gray-400">Syncing {friendNames.length + 1} calendars &amp; finding overlaps…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            {(() => {
              const unsynced = participants.filter(p => !p.calendarConnected);
              if (unsynced.length > 0) {
                const names = unsynced.map(p => p.displayName.split(' ')[0]).join(', ');
                const allUnsynced = unsynced.length === participants.length;
                return (
                  <>
                    <span className="text-3xl">📅</span>
                    <h4 className="mt-3 text-sm font-semibold text-gray-800">
                      {allUnsynced ? "No one has connected their calendar yet!" : `${names} haven't connected their calendars`}
                    </h4>
                    <p className="mt-1.5 max-w-sm text-xs text-gray-500 leading-relaxed">
                      {allUnsynced
                        ? "Everyone needs to connect a calendar so Slotted can find times that work. Share a reminder!"
                        : `Once ${names} connect${unsynced.length === 1 ? 's' : ''}, Slotted will find times everyone is free.`}
                    </p>
                    {unsynced.some(p => p.userId === participants[0]?.userId) && (
                      <a href="/settings" className="mt-4 inline-flex rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 py-2 text-xs font-semibold text-white shadow-sm">
                        Connect my calendar
                      </a>
                    )}
                  </>
                );
              }
              return (
                <>
                  <span className="text-3xl">😅</span>
                  <h4 className="mt-3 text-sm font-semibold text-gray-800">Everyone's pretty busy!</h4>
                  <p className="mt-1.5 max-w-sm text-xs text-gray-500 leading-relaxed">
                    No common free times for all {friendNames.length + 1} people in the next 2 weeks. Try a smaller group or check back soon!
                  </p>
                </>
              );
            })()}
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
                {/* Time info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                    {idx === 0 && (
                      <span className="rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-2 py-0.5 text-xs font-bold text-white">
                        Best match
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{slot.timeLabel}</p>
                  {slot.reasons.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {slot.reasons.slice(0, 3).map((r) => (
                        <span key={r} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Book button */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleBook(slot)}
                    disabled={bookingSlot === slot.start}
                    className={`rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 ${
                      booked === slot.start
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white'
                    }`}
                  >
                    {bookingSlot === slot.start ? '...' : booked === slot.start ? 'Sent! ✓' : 'Book it'}
                  </button>
                </div>
              </div>
            ))}

            <p className="pt-2 text-center text-[11px] text-gray-500">
              {overlaps.length} overlapping windows · Showing top {suggestions.length} for all {friendNames.length + 1} people
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-5 py-3 flex justify-between items-center">
        {bookError ? (
          <p className="text-[11px] text-red-500 font-medium">{bookError}</p>
        ) : (
          <p className="text-[11px] text-gray-500">Based on the next 2 weeks of all calendars</p>
        )}
        <button
          onClick={fetchGroupOverlaps}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
        >
          {loading ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {/* Add to Calendar modal */}
      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => setCalendarModal(null)}
        />
      )}
    </div>
  );
}
