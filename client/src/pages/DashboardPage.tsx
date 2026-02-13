import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

const ACTIVITY_OPTIONS = [
  { value: 'coffee', emoji: '☕', label: 'Coffee' },
  { value: 'meal', emoji: '🍽️', label: 'Meal' },
  { value: 'drinks', emoji: '🍻', label: 'Drinks' },
  { value: 'walk', emoji: '🚶', label: 'Walk' },
  { value: 'workout', emoji: '💪', label: 'Workout' },
  { value: 'movie', emoji: '🎬', label: 'Movie' },
  { value: 'game_night', emoji: '🎮', label: 'Game Night' },
  { value: 'hangout', emoji: '😎', label: 'Hangout' },
  { value: 'other', emoji: '✨', label: 'Other' },
];

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3+ hours' },
];

const TIME_OPTIONS = [
  { value: 'morning', emoji: '🌅', label: 'Morning' },
  { value: 'afternoon', emoji: '☀️', label: 'Afternoon' },
  { value: 'evening', emoji: '🌆', label: 'Evening' },
  { value: 'night', emoji: '🌙', label: 'Night' },
];

const CANCEL_REASONS = [
  { value: 'sick', emoji: '🤒', label: 'Sick' },
  { value: 'cancelled', emoji: '❌', label: 'Cancelled' },
  { value: 'something_came_up', emoji: '😬', label: 'Something came up' },
  { value: 'too_tired', emoji: '😴', label: 'Too tired' },
  { value: 'scheduling_conflict', emoji: '📅', label: 'Scheduling conflict' },
  { value: 'other', emoji: '🤷', label: 'Other' },
];

interface Meetup {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  participants: { userId: string; displayName: string; photoUrl: string | null; rsvp: string }[];
  myRsvp: string;
}

export default function DashboardPage() {
  const { user, calendarConnected, calendarJustConnected } = useAuth();

  // Log hangout form state (manual)
  const [showLogForm, setShowLogForm] = useState(false);
  const [logActivity, setLogActivity] = useState('hangout');
  const [logDuration, setLogDuration] = useState(60);
  const [logTimeOfDay, setLogTimeOfDay] = useState('afternoon');
  const [logRating, setLogRating] = useState(0);
  const [logSaving, setLogSaving] = useState(false);
  const [logSaved, setLogSaved] = useState(false);

  // Meetups
  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [didntHappenId, setDidntHappenId] = useState<string | null>(null);
  const [reasonSaving, setReasonSaving] = useState(false);

  // Dashboard data
  const [friendCount, setFriendCount] = useState(0);
  const [freeSlotCount, setFreeSlotCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const timeEmoji =
    today.getHours() < 12 ? '☀️' : today.getHours() < 18 ? '🌤️' : '🌙';

  // Fetch friend count
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get('/friends');
        const accepted = (data.friends || []).filter((f: any) => f.status === 'accepted');
        setFriendCount(accepted.length);
      } catch { /* silent */ }
    })();
  }, [user]);

  // Fetch meetups
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get('/meetups');
        setMeetups(data.meetups || []);
      } catch { /* silent */ }
    })();
  }, [user]);

  // Auto-sync calendar on load
  useEffect(() => {
    if (!user || !calendarConnected) return;
    (async () => {
      setSyncing(true);
      try {
        const { data } = await api.post('/calendar/sync');
        setFreeSlotCount(data.freeSlots ?? null);
      } catch { /* silent */ }
      finally { setSyncing(false); }
    })();
  }, [user, calendarConnected]);

  // Past confirmed meetups = auto-detected hangouts
  const now = new Date();
  const pastConfirmed = meetups.filter((m) => {
    const end = new Date(m.end_time);
    return end < now && (m.status === 'confirmed' || (m.status === 'proposed' && m.myRsvp === 'accepted'));
  });

  // Upcoming meetups
  const upcoming = meetups.filter((m) => {
    const start = new Date(m.start_time);
    return start >= now && m.status !== 'cancelled' && m.status !== 'didnt_happen' && m.status !== 'declined';
  });

  const handleDidntHappen = async (meetupId: string, reason: string) => {
    setReasonSaving(true);
    try {
      await api.patch(`/meetups/${meetupId}/didnt-happen`, { reason });
      setMeetups((prev) => prev.map((m) => m.id === meetupId ? { ...m, status: 'didnt_happen' } : m));
      setDidntHappenId(null);
    } catch { /* silent */ }
    finally { setReasonSaving(false); }
  };

  const formatMeetupTime = (start: string) => {
    const d = new Date(start);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const otherParticipants = (m: Meetup) =>
    m.participants.filter((p) => p.userId !== user?.uid?.replace(/^firebase_/, ''));

  return (
    <AppShell>
      {/* Header row with greeting */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
          {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Calendar just connected toast */}
      {calendarJustConnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-in fade-in">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-emerald-700">Calendar connected! Slotted will now use your availability.</p>
        </div>
      )}

      {/* Bento grid layout — asymmetric, modern */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Hero card — spans 2 columns on desktop: This Week */}
        <div className="md:col-span-2 md:row-span-2 rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-gray-900">This Week</h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">📅 My Calendar</span>
          </div>
          <div className="h-[420px] w-full">
            <iframe
              src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(user?.email ?? '')}&mode=WEEK&showTitle=0&showNav=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&wkst=1`}
              className="h-full w-full border-0"
              title="Google Calendar"
            />
          </div>
        </div>

        {/* Right column — stacked stat cards */}
        <Link to="/friends" className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">👯</span>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Friends</p>
          </div>
          <p className="mt-4 text-4xl font-bold text-gray-900">{friendCount}</p>
          <p className="mt-1 text-xs text-gray-400">
            {friendCount === 0 ? 'Invite friends to get started' : 'Tap to find times →'}
          </p>
        </Link>

        <div className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">{calendarConnected ? '📅' : '✨'}</span>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
              {calendarConnected ? 'Availability' : 'Calendar'}
            </p>
          </div>
          <p className="mt-4 text-4xl font-bold text-gray-900">
            {syncing ? (
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-amber-400 border-t-transparent" />
            ) : calendarConnected ? (
              freeSlotCount ?? '–'
            ) : (
              '–'
            )}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {syncing
              ? 'Syncing calendar…'
              : calendarConnected
                ? `Free blocks next 2 weeks`
                : (
                  <Link to="/settings" className="text-slotted-600 underline">
                    Connect calendar →
                  </Link>
                )}
          </p>
        </div>

        {/* Upcoming hangouts */}
        {upcoming.length > 0 && (
          <div className="md:col-span-3 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🗓️</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Upcoming Hangouts</h2>
            </div>
            <div className="space-y-2">
              {upcoming.slice(0, 3).map((m) => {
                const others = otherParticipants(m);
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/30 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        {others.slice(0, 3).map((p) => (
                          p.photoUrl ? (
                            <img key={p.userId} src={p.photoUrl} alt="" className="h-8 w-8 rounded-full ring-2 ring-white" />
                          ) : (
                            <div key={p.userId} className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-white">
                              {p.displayName?.[0] ?? '?'}
                            </div>
                          )
                        ))}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{m.title}</p>
                        <p className="text-[11px] text-gray-400">
                          {others.map((p) => p.displayName).join(', ')} · {formatMeetupTime(m.start_time)}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${
                      m.myRsvp === 'accepted'
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : m.myRsvp === 'pending'
                          ? 'border border-amber-200 bg-amber-50 text-amber-700'
                          : 'border border-gray-200 bg-gray-50 text-gray-500'
                    }`}>
                      {m.myRsvp === 'accepted' ? '✅ Confirmed' : m.myRsvp === 'pending' ? '⏳ Pending' : m.myRsvp}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Hangout History — auto-detected + manual log */}
        <div className="md:col-span-3 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">📝</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Hangout History</h2>
            </div>
            {!calendarConnected && !showLogForm && (
              <button
                onClick={() => setShowLogForm(true)}
                className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                + Log manually
              </button>
            )}
          </div>

          {/* Auto-detected hangouts (calendar users) */}
          {calendarConnected && pastConfirmed.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-gray-400">
                Auto-detected from your calendar — both calendars confirmed these events
              </p>
              {pastConfirmed.map((m) => {
                const others = otherParticipants(m);
                const isDidntHappen = didntHappenId === m.id;
                if (m.status === 'didnt_happen') return null;
                return (
                  <div key={m.id} className="rounded-xl border border-gray-100 bg-gray-50/30 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-base">✅</span>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{m.title}</p>
                          <p className="text-[11px] text-gray-400">
                            {others.map((p) => p.displayName).join(', ')} · {formatMeetupTime(m.start_time)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setDidntHappenId(isDidntHappen ? null : m.id)}
                        className="text-[11px] font-medium text-gray-400 hover:text-red-500 transition-colors"
                      >
                        {isDidntHappen ? 'Cancel' : "Didn't happen"}
                      </button>
                    </div>

                    {/* Cancellation reason picker */}
                    {isDidntHappen && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-red-50/30">
                        <p className="text-[11px] font-medium text-gray-600 mb-2">What happened?</p>
                        <div className="flex flex-wrap gap-1.5">
                          {CANCEL_REASONS.map((r) => (
                            <button
                              key={r.value}
                              disabled={reasonSaving}
                              onClick={() => handleDidntHappen(m.id, r.value)}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            >
                              {r.emoji} {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state for auto-detected */}
          {calendarConnected && pastConfirmed.filter((m) => m.status !== 'didnt_happen').length === 0 && !showLogForm && (
            <p className="mt-3 text-xs text-gray-400">
              No hangouts detected yet — when you and a friend both accept a scheduled meetup, it'll automatically appear here
            </p>
          )}

          {/* Manual log toggle for calendar users */}
          {calendarConnected && !showLogForm && (
            <button
              onClick={() => setShowLogForm(true)}
              className="mt-3 text-[11px] font-medium text-gray-400 hover:text-slotted-600 transition-colors"
            >
              + Log a hangout manually (for in-person meetups not on calendar)
            </button>
          )}

          {/* Non-calendar explanation */}
          {!calendarConnected && !showLogForm && pastConfirmed.length === 0 && (
            <p className="mt-2 text-xs text-gray-400">
              Log your hangouts here so Slotted can learn your preferences. Connect a calendar for auto-detection!
            </p>
          )}

          {/* Manual log form */}
          {showLogForm && (
            <div className="mt-4 space-y-4">
              {/* Activity type */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">What did you do?</label>
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogActivity(opt.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        logActivity === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">How long?</label>
                <div className="flex gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogDuration(opt.value)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                        logDuration === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time of day */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">What time?</label>
                <div className="flex gap-1.5">
                  {TIME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLogTimeOfDay(opt.value)}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                        logTimeOfDay === opt.value
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating row */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400 mr-1">Vibe:</span>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setLogRating(star === logRating ? 0 : star)}
                      className={`text-lg transition-all hover:scale-110 ${star <= logRating ? 'opacity-100' : 'opacity-30'}`}
                    >
                      ⭐
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  disabled={logSaving}
                  onClick={async () => {
                    setLogSaving(true);
                    try {
                      const token = await user?.getIdToken();
                      await fetch('/api/meetup-logs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({
                          activity_type: logActivity,
                          duration_min: logDuration,
                          day_of_week: new Date().getDay(),
                          time_of_day: logTimeOfDay,
                          rating: logRating || null,
                        }),
                      });
                      setLogSaved(true);
                      setTimeout(() => { setLogSaved(false); setShowLogForm(false); }, 2000);
                    } catch {
                      // silent
                    } finally {
                      setLogSaving(false);
                    }
                  }}
                  className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                    logSaved ? 'bg-emerald-500' : 'gradient-btn'
                  }`}
                >
                  {logSaving ? 'Saving...' : logSaved ? 'Logged! ✓' : 'Save Hangout'}
                </button>
                <button
                  onClick={() => setShowLogForm(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
