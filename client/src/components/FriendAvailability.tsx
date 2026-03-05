import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { trackMeetupScheduled } from '../lib/analytics';
import { useAuth } from '../contexts/AuthContext';
import AddToCalendarModal from './AddToCalendarModal';

type HangoutMode = 'in_person' | 'phone' | 'video';
type VideoPlatform = 'facetime' | 'zoom' | 'google_meet' | 'teams' | 'whatsapp' | 'duo' | '';

const MODE_CONFIG: Record<HangoutMode, { emoji: string; label: string; shortLabel: string }> = {
  in_person: { emoji: '🤝', label: 'In person', shortLabel: 'Meet up' },
  phone: { emoji: '📞', label: 'Phone call', shortLabel: 'Call' },
  video: { emoji: '💻', label: 'Video call', shortLabel: 'Video call' },
};

const VIDEO_PLATFORMS: { value: VideoPlatform; emoji: string; label: string }[] = [
  { value: 'facetime', emoji: '📱', label: 'FaceTime' },
  { value: 'zoom', emoji: '📹', label: 'Zoom' },
  { value: 'google_meet', emoji: '🌐', label: 'Google Meet' },
  { value: 'teams', emoji: '💼', label: 'Teams' },
  { value: 'whatsapp', emoji: '💬', label: 'WhatsApp' },
  { value: 'duo', emoji: '📞', label: 'Google Meet (Duo)' },
];


interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  reasons: string[];
  dayLabel: string;
  timeLabel: string;
}

interface SyncStatus {
  me: { synced: boolean };
  friend: { synced: boolean; name: string; calendarConnected: boolean };
}

interface FriendAvailabilityProps {
  friendId: string;
  friendName: string;
  onClose: () => void;
  onBook?: (slot: ScoredSlot) => void;
}

export default function FriendAvailability({ friendId, friendName, onClose, onBook }: FriendAvailabilityProps) {
  const { user } = useAuth();
  const myFirstName = user?.displayName?.split(' ')[0] || 'Me';
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<ScoredSlot[]>([]);
  const [overlaps, setOverlaps] = useState<{ start: string; end: string }[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [bookedLabel, setBookedLabel] = useState<{ day: string; time: string; title: string } | null>(null);
  const [hangoutMode, setHangoutMode] = useState<HangoutMode>('in_person');
  const [videoPlatform, setVideoPlatform] = useState<VideoPlatform>('');
  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  const fetchOverlaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/availability/overlap/${friendId}?mode=${hangoutMode}`);
      setSuggestions(data.suggestions || []);
      setOverlaps(data.overlaps || []);
      setSyncStatus(data.syncStatus || null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to find availability');
    } finally {
      setLoading(false);
    }
  }, [friendId, hangoutMode]);

  useEffect(() => {
    fetchOverlaps();
  }, [fetchOverlaps]);

  const handleBook = async (slot: ScoredSlot) => {
    setBookingSlot(slot.start);
    const friendFirst = friendName.split(' ')[0];
    const bookingTitle = hangoutMode === 'in_person'
      ? `${myFirstName} & ${friendFirst} hangout`
      : hangoutMode === 'phone'
        ? `${myFirstName} & ${friendFirst} phone call`
        : `${myFirstName} & ${friendFirst} video call`;
    try {
      const { data } = await api.post('/meetups', {
        title: bookingTitle,
        friendId,
        startTime: slot.start,
        endTime: slot.end,
      });
      trackMeetupScheduled();
      // Check for quota warning
      if (data.quotaWarning) {
        const proceed = window.confirm(data.quotaWarning.message);
        if (!proceed) {
          // Cancel the meetup
          try { await api.patch(`/meetups/${data.id}/rsvp`, { rsvp: 'declined' }); } catch {}
          setBookingSlot(null);
          return;
        }
      }
      setBooked(slot.start);
      setBookedLabel({
        day: suggestions.find(s => s.start === slot.start)?.dayLabel || '',
        time: suggestions.find(s => s.start === slot.start)?.timeLabel || '',
        title: bookingTitle,
      });
      onBook?.(slot);
    } catch {
      // silent fail
    } finally {
      setBookingSlot(null);
    }
  };


  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-4 bg-gradient-to-r from-slotted-50/30 to-purple-50/30">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-gray-900 truncate">
            ✨ AI Suggestions with {friendName}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Best times to meet based on both your calendars &amp; preferences
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

      {/* Hangout mode toggle */}
      <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 border-b border-gray-100 bg-gray-50/50">
        {(['in_person', 'phone', 'video'] as HangoutMode[]).map((mode) => {
          const cfg = MODE_CONFIG[mode];
          const isActive = hangoutMode === mode;
          return (
            <button
              key={mode}
              onClick={() => setHangoutMode(mode)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
              }`}
            >
              <span>{cfg.emoji}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Video platform picker — only show when video mode is selected */}
      {hangoutMode === 'video' && (
        <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2 border-b border-gray-100 bg-gray-50/30">
          <span className="text-[10px] text-gray-400 mr-1">Platform:</span>
          {VIDEO_PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => setVideoPlatform(videoPlatform === p.value ? '' : p.value)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                videoPlatform === p.value
                  ? 'bg-slotted-50 text-slotted-700 border border-slotted-200 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white border border-transparent'
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Sync status — only show if MY calendar isn't synced */}
      {syncStatus && !syncStatus.me.synced && (
        <div className="px-5 py-3 border-b border-gray-100">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            ⚠️ Your calendar isn't synced yet — connect in Settings for better suggestions
          </span>
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
            <p className="text-xs text-gray-400 mt-0.5">{bookedLabel.day} · {bookedLabel.time}</p>

            <div className="mt-5 w-full max-w-xs space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">What happens next</h4>
              <div className="space-y-2.5 text-left">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs">1</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{friendName} gets notified</p>
                    <p className="text-[11px] text-gray-400">They'll see the invite in their Slotted.ai notifications</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs">2</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">They accept or decline</p>
                    <p className="text-[11px] text-gray-400">They'll see accept/decline buttons on their Dashboard</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs">3</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Once confirmed, add to calendar</p>
                    <p className="text-[11px] text-gray-400">When they say yes, you'll both be prompted to add it to your calendars</p>
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
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-slotted-400 border-t-transparent" />
            <p className="mt-3 text-xs text-gray-400">Syncing calendars &amp; finding the best times…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-4xl">📅</span>
            <h4 className="mt-3 text-sm font-semibold text-gray-800">No overlapping free times found</h4>
            <p className="mt-1.5 max-w-sm text-xs text-gray-400 leading-relaxed">
              {!syncStatus?.me.synced
                ? "Connect your Google Calendar in Settings to let Slotted.ai find available times."
                : "Both calendars are packed for the next 2 weeks. Try adjusting your schedules or check back later."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((slot, idx) => (
              <div
                key={slot.start}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  idx === 0
                    ? 'border-slotted-200 bg-gradient-to-r from-slotted-50/60 to-purple-50/40 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                {/* Time info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                    {idx === 0 && (
                      <span className="rounded-full bg-gradient-to-r from-slotted-500 to-purple-500 px-2 py-0.5 text-[10px] font-bold text-white">
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

                {/* Book button */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleBook(slot)}
                    disabled={bookingSlot === slot.start}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 ${
                      booked === slot.start
                        ? 'bg-emerald-500 text-white'
                        : 'gradient-btn text-white'
                    }`}
                  >
                    {bookingSlot === slot.start ? '...' : booked === slot.start ? 'Sent! ✓' : 'Book'}
                  </button>
                </div>
              </div>
            ))}

            <p className="pt-2 text-center text-[11px] text-gray-400">
              {overlaps.length} overlapping windows found · Showing top {suggestions.length} suggestions
            </p>
          </div>
        )}
      </div>

      {/* Refresh button */}
      <div className="border-t border-gray-100 px-5 py-3 flex justify-between items-center">
        <p className="text-[11px] text-gray-400">Based on the next 2 weeks of both calendars</p>
        <button
          onClick={fetchOverlaps}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
        >
          {loading ? 'Syncing…' : '🔄 Refresh'}
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
