import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { trackMeetupScheduled } from '../lib/analytics';
import { getFirstName, getSmartDisplayName } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import AddToCalendarModal from './AddToCalendarModal';
import ActivityPicker from './ActivityPicker';

type HangoutMode = 'in_person' | 'call';
type VideoPlatform = 'phone' | 'facetime' | 'zoom' | 'google_meet' | 'teams' | 'whatsapp' | '';

const MODE_CONFIG: Record<HangoutMode, { label: string; shortLabel: string }> = {
  in_person: { label: 'In person', shortLabel: 'Meet up' },
  call: { label: 'Call', shortLabel: 'Call' },
};

const CALL_PLATFORMS: { value: VideoPlatform; label: string }[] = [
  { value: 'phone', label: '📞 Phone' },
  { value: 'facetime', label: 'FaceTime' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'google_meet', label: 'Google Meet' },
  { value: 'teams', label: 'Teams' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultManualStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(13, 0, 0, 0);
  return localInputValue(d);
}

function defaultManualEnd(startValue: string): string {
  const d = new Date(startValue);
  d.setHours(d.getHours() + 2);
  return localInputValue(d);
}

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
}

interface FriendAvailabilityProps {
  friendId: string;
  friendName: string;
  allFriendNames?: string[];
  onClose: () => void;
  onBook?: (slot: ScoredSlot) => void;
  completedHangouts?: number;
  embedded?: boolean;
}

export default function FriendAvailability({ friendId, friendName, allFriendNames = [], onClose, onBook, completedHangouts = 0, embedded = false }: FriendAvailabilityProps) {
  const { user } = useAuth();
  const myFirstName = getFirstName(user?.displayName) || 'Me';
  const friendFirst = getSmartDisplayName(friendName, allFriendNames);
  const isFirstTime = completedHangouts === 0;
  const [hangoutMode, setHangoutMode] = useState<HangoutMode>('in_person');
  const [videoPlatform, setVideoPlatform] = useState<VideoPlatform>('');
  const [showOtherTimes, setShowOtherTimes] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [bookedLabel, setBookedLabel] = useState<{ day: string; time: string; title: string } | null>(null);
  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [pendingSlot, setPendingSlot] = useState<ScoredSlot | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualStart, setManualStart] = useState(defaultManualStart);
  const [manualEnd, setManualEnd] = useState(() => defaultManualEnd(defaultManualStart()));
  const [manualTitle, setManualTitle] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const { data: overlapData, isLoading: loading, error: fetchError, refetch: fetchOverlaps } = useQuery({
    queryKey: ['availability-overlap', friendId, hangoutMode],
    queryFn: async () => {
      const { data } = await api.get(`/availability/overlap/${friendId}?mode=${hangoutMode}`);
      return data;
    },
    staleTime: 1000 * 60 * 2,
  });

  const suggestions: ScoredSlot[] = overlapData?.suggestions || [];
  const overlaps = overlapData?.overlaps || [];
  const syncStatus: SyncStatus | null = overlapData?.syncStatus || null;
  const shapedFetchError = fetchError as { response?: { data?: { error?: string } }; message?: string } | null;
  const error = fetchError
    ? (shapedFetchError?.response?.data?.error || shapedFetchError?.message || 'Failed to find availability')
    : null;

  const handleBook = async (slot: ScoredSlot, titleOverride?: string) => {
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
    const bookingTitle = titleOverride
      || (hangoutMode === 'in_person'
        ? `${myFirstName} & ${friendFirst} hangout`
        : `${myFirstName} & ${friendFirst} call`);
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
          try {
            await api.patch(`/meetups/${data.id}/rsvp`, { rsvp: 'declined' });
          } catch (err) {
            console.warn('Failed to cancel declined meetup:', err);
          }
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

  const handleManualInvite = async () => {
    const start = new Date(manualStart);
    const end = new Date(manualEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setBookError('Pick a valid start and end time');
      return;
    }
    if (start <= new Date()) {
      setBookError("Pick a time that hasn't happened yet 😊");
      return;
    }
    if (end <= start) {
      setBookError('End time must be after start time');
      return;
    }
    setManualSubmitting(true);
    setBookError(null);
    const bookingTitle = manualTitle.trim() || `${myFirstName} & ${friendFirst} hangout`;
    try {
      const { data } = await api.post('/meetups/manual-invite', {
        friendId,
        title: bookingTitle,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        location: manualLocation.trim() || undefined,
      });
      trackMeetupScheduled();
      setBooked(start.toISOString());
      setBookedLabel({
        day: start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        time: `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
        title: bookingTitle,
      });
      onBook?.({
        start: data.start_time || start.toISOString(),
        end: data.end_time || end.toISOString(),
        score: 0,
        reasons: [],
        dayLabel: '',
        timeLabel: '',
      });
    } catch (err: unknown) {
      const shaped = err as { response?: { data?: { error?: string } }; message?: string };
      setBookError(shaped.response?.data?.error || shaped.message || 'Could not create the invite');
    } finally {
      setManualSubmitting(false);
    }
  };


  return (
    <div className={`mx-auto max-w-sm overflow-hidden rounded-2xl border border-gray-200/60 bg-white ${embedded ? 'shadow-sm' : 'shadow-lg'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-slotted-50/30 to-sky-50/30 px-3 sm:px-4 ${embedded ? 'py-2.5' : 'py-3'}`}>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-gray-900 truncate">
            Suggestions with {getSmartDisplayName(friendName, allFriendNames)}
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-gray-500">
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
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50/50 px-3 sm:px-4 py-2">
        {(['in_person', 'call'] as HangoutMode[]).map((mode) => {
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
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Call platform picker — show when call mode is selected */}
      {hangoutMode === 'call' && (
        <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2 border-b border-gray-100 bg-gray-50/30 overflow-x-auto">
          <span className="text-xs text-gray-500 mr-1 shrink-0">Via:</span>
          {CALL_PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => setVideoPlatform(videoPlatform === p.value ? '' : p.value)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                videoPlatform === p.value
                  ? 'bg-slotted-50 text-slotted-700 border border-slotted-200 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white border border-transparent'
              }`}
            >
              {p.label}
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
      <div className={`px-3 sm:px-4 ${embedded ? 'py-2.5' : 'py-3'}`}>
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
                    <p className="text-sm font-medium text-gray-800">{getSmartDisplayName(friendName, allFriendNames)} gets notified</p>
                    <p className="text-[11px] text-gray-500">They'll see the invite in their Slotted.ai notifications</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs">2</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">They accept or decline</p>
                    <p className="text-[11px] text-gray-500">They'll see accept/decline buttons on their Dashboard</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs">3</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Once confirmed, add to calendar</p>
                    <p className="text-[11px] text-gray-500">When they say yes, you'll both be prompted to add it to your calendars</p>
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
          <div className="flex flex-col items-center justify-center py-8">
            <div className="h-7 w-7 animate-spin rounded-full border-3 border-slotted-400 border-t-transparent" />
            <p className="mt-2 text-xs text-gray-400">Syncing calendars &amp; finding the best times…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-5 text-center">
            {(() => {
              const meNotSynced = !syncStatus?.me.synced;

              if (meNotSynced) {
                return (
                  <>
                    <span className="text-2xl">📅</span>
                    <h4 className="mt-2 text-sm font-semibold text-gray-800">Connect your calendar first</h4>
                    <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-500">
                      Slotted needs your calendar to find when you're free. It only sees busy/free — never event details.
                    </p>
                    <a href="/settings" className="mt-3 inline-flex rounded-lg gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm">
                      Connect my calendar
                    </a>
                  </>
                );
              }
              // Privacy: we never reveal whether the friend has synced their
              // calendar. Either we found times (handled in the else branch
              // above) or we didn't — the reason isn't shared.
              return (
                <>
                  <span className="text-2xl">😅</span>
                  <h4 className="mt-2 text-sm font-semibold text-gray-800">Still finding times</h4>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-500">
                    No overlapping free times yet. Try checking back in a few days — schedules change!
                  </p>
                </>
              );
            })()}
          </div>
        ) : isFirstTime && suggestions.length > 0 ? (
          /* ──── Single-suggestion mode for first-time schedulers ──── */
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center py-4">
              <p className="text-lg font-semibold text-gray-900">
                How about {suggestions[0].dayLabel} at {suggestions[0].timeLabel}?
              </p>
              <p className="mt-2 text-sm text-gray-500">
                This time looks promising for both of you.
              </p>
              <button
                onClick={() => setPendingSlot(suggestions[0])}
                disabled={bookingSlot === suggestions[0].start}
                className="mt-5 rounded-xl gradient-btn px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
              >
                {bookingSlot === suggestions[0].start ? 'Booking…' : 'Book it'}
              </button>
            </div>

            {suggestions.length > 1 && (
              <div className="border-t border-gray-100 pt-3">
                <button
                  onClick={() => setShowOtherTimes(!showOtherTimes)}
                  className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Other times that work
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${showOtherTimes ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showOtherTimes && (
                  <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1">
                    {suggestions.slice(1, 5).map((slot) => (
                      <div
                        key={slot.start}
                        className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:border-gray-300 hover:bg-gray-50/50 transition-all"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                          <p className="text-xs text-gray-500">{slot.timeLabel}</p>
                        </div>
                        <button
                          onClick={() => setPendingSlot(slot)}
                          disabled={bookingSlot === slot.start}
                          className="rounded-xl gradient-btn px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
                        >
                          {bookingSlot === slot.start ? '...' : 'Book'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((slot, idx) => (
              <div
                key={slot.start}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                  idx === 0
                    ? 'border-slotted-200 bg-gradient-to-r from-slotted-50/60 to-sky-50/40 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                {/* Time info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                    {idx === 0 && (
                      <span className="rounded-full bg-gradient-to-r from-slotted-500 to-sky-500 px-2 py-0.5 text-xs font-bold text-white">
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
                    onClick={() => setPendingSlot(slot)}
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

            <p className="pt-2 text-center text-[11px] text-gray-500">
              {overlaps.length} overlapping windows found · Showing top {suggestions.length} suggestions
            </p>
          </div>
        )}
      </div>

      {/* Activity picker — shown after selecting a slot, before booking */}
      {pendingSlot && !booked && (
        <div className="px-5 pb-4">
          <ActivityPicker
            date={pendingSlot.start}
            startTime={new Date(pendingSlot.start).toTimeString().slice(0, 5)}
            endTime={new Date(pendingSlot.end).toTimeString().slice(0, 5)}
            onSelectFreestyle={() => {
              handleBook(pendingSlot);
              setPendingSlot(null);
            }}
            onSelectEvent={(event) => {
              handleBook(pendingSlot, event.title);
              setPendingSlot(null);
            }}
          />
        </div>
      )}

      {!booked && (
        <div className="border-t border-gray-100 px-3 py-3 sm:px-4">
          <button
            type="button"
            onClick={() => setManualOpen((prev) => !prev)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-left transition-colors hover:bg-sky-100"
          >
            <span>
              <span className="block text-xs font-semibold text-sky-800">Already agreed on a time?</span>
              <span className="block text-[11px] text-sky-600">Send a calendar invite manually</span>
            </span>
            <span className="text-sm text-sky-500">{manualOpen ? '−' : '+'}</span>
          </button>
          {manualOpen && (
            <div className="mt-3 space-y-2 rounded-xl border border-sky-100 bg-white p-3">
              <label className="block text-xs font-medium text-gray-700">
                Title
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder={`${myFirstName} & ${friendFirst} hangout`}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-gray-700">
                  Starts
                  <input
                    type="datetime-local"
                    value={manualStart}
                    onChange={(e) => {
                      setManualStart(e.target.value);
                      setManualEnd(defaultManualEnd(e.target.value));
                    }}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="block text-xs font-medium text-gray-700">
                  Ends
                  <input
                    type="datetime-local"
                    value={manualEnd}
                    onChange={(e) => setManualEnd(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-gray-700">
                Location <span className="font-normal text-gray-400">(optional)</span>
                <input
                  type="text"
                  value={manualLocation}
                  onChange={(e) => setManualLocation(e.target.value)}
                  placeholder="e.g. coffee, walk, your place"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <p className="text-[11px] leading-relaxed text-gray-500">
                Use this when you and {friendFirst} already picked the time. Slotted will create the plan, add it to your calendar, and send {friendFirst} an invite/fallback email.
              </p>
              <button
                type="button"
                onClick={handleManualInvite}
                disabled={manualSubmitting}
                className="min-h-[44px] w-full rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
              >
                {manualSubmitting ? 'Sending…' : `Send invite to ${friendFirst}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Refresh button */}
      <div className="border-t border-gray-100 px-5 py-3 flex justify-between items-center">
        {bookError ? (
          <p className="text-[11px] text-red-500 font-medium">{bookError}</p>
        ) : (
          <p className="text-[11px] text-gray-500">Based on the next 2 weeks of both calendars</p>
        )}
        <button
          onClick={() => fetchOverlaps()}
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
