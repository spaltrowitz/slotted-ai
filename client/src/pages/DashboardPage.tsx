import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

/* ─── constants ─── */
const ACTIVITY_OPTIONS = [
  { value: 'coffee', emoji: '☕', label: 'Coffee', virtual: false },
  { value: 'meal', emoji: '🍽️', label: 'Meal', virtual: false },
  { value: 'drinks', emoji: '🍻', label: 'Drinks', virtual: false },
  { value: 'walk', emoji: '🚶', label: 'Walk', virtual: false },
  { value: 'workout', emoji: '💪', label: 'Workout', virtual: false },
  { value: 'movie', emoji: '🎬', label: 'Movie', virtual: false },
  { value: 'game_night', emoji: '🎮', label: 'Game Night', virtual: false },
  { value: 'hangout', emoji: '😎', label: 'Hangout', virtual: false },
  { value: 'phone_call', emoji: '📞', label: 'Phone Call', virtual: true },
  { value: 'facetime', emoji: '📱', label: 'FaceTime', virtual: true },
  { value: 'video_call', emoji: '💻', label: 'Video Call', virtual: true },
  { value: 'other', emoji: '✨', label: 'Other', virtual: false },
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

/* ─── types ─── */
interface Meetup {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  participants: { userId: string; displayName: string; photoUrl: string | null; rsvp: string }[];
  myRsvp: string;
}
interface FriendToSee {
  id: string;
  displayName: string;
  photoUrl: string | null;
  socialBattery: string;
  lastHangout: string | null;
  neighborhood: string | null;
  timezone: string | null;
  friendshipType: string;
}

/* ─── helpers ─── */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

function friendLocalTime(tz: string | null): string | null {
  if (!tz) return null;
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return null; }
}

const TYPE_BADGE: Record<string, { emoji: string; label: string }> = {
  local: { emoji: '📍', label: 'Local' },
  long_distance: { emoji: '📞', label: 'Long distance' },
  both: { emoji: '🌐', label: 'Both' },
};

/* ─── component ─── */
export default function DashboardPage() {
  const { user, calendarConnected, calendarJustConnected } = useAuth();

  // Calendar view state
  const [calView, setCalView] = useState<'WEEK' | 'MONTH'>('WEEK');

  // Dashboard data
  const [friendsToSee, setFriendsToSee] = useState<FriendToSee[]>([]);
  const [stats, setStats] = useState({ totalFriends: 0, hangoutsThisMonth: 0, totalPastHangouts: 0 });

  // Meetups
  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [didntHappenId, setDidntHappenId] = useState<string | null>(null);
  const [reasonSaving, setReasonSaving] = useState(false);

  // Calendar sync
  const [syncing, setSyncing] = useState(false);

  // Log form
  const [showLogForm, setShowLogForm] = useState(false);
  const [logActivity, setLogActivity] = useState('hangout');
  const [logDuration, setLogDuration] = useState(60);
  const [logTimeOfDay, setLogTimeOfDay] = useState('afternoon');
  const [logRating, setLogRating] = useState(0);
  const [logSaving, setLogSaving] = useState(false);
  const [logSaved, setLogSaved] = useState(false);

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const timeEmoji =
    today.getHours() < 12 ? '☀️' : today.getHours() < 18 ? '🌤️' : '🌙';

  /* ─── data fetching ─── */
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get('/dashboard');
        setFriendsToSee(data.friendsToSee || []);
        setStats(data.stats || { totalFriends: 0, hangoutsThisMonth: 0, totalPastHangouts: 0 });
      } catch { /* silent */ }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get('/meetups');
        setMeetups(data.meetups || []);
      } catch { /* silent */ }
    })();
  }, [user]);

  useEffect(() => {
    if (!user || !calendarConnected) return;
    (async () => {
      setSyncing(true);
      try {
        const { data: _syncData } = await api.post('/calendar/sync');
        // sync happens silently, no slot count displayed
      } catch { /* silent */ }
      finally { setSyncing(false); }
    })();
  }, [user, calendarConnected]);

  /* ─── derived ─── */
  const now = useMemo(() => new Date(), []);
  const upcoming = meetups.filter((m) => {
    const start = new Date(m.start_time);
    return start >= now && !['cancelled', 'didnt_happen', 'declined'].includes(m.status);
  });
  const pastConfirmed = meetups.filter((m) => {
    const end = new Date(m.end_time);
    return end < now && (m.status === 'confirmed' || (m.status === 'proposed' && m.myRsvp === 'accepted'));
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

  /* ─── calendar embed URL ─── */
  const calendarUrl = useMemo(() => {
    const params = new URLSearchParams({
      src: user?.email ?? '',
      mode: calView,
      showTitle: '0',
      showNav: '1',
      showPrint: '0',
      showTabs: '0',
      showCalendars: '0',
      showTz: '0',
      wkst: '1',
    });
    return `https://calendar.google.com/calendar/embed?${params.toString()}`;
  }, [user?.email, calView]);

  return (
    <AppShell>
      {/* ─── HEADER ─── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
            {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {/* Quick actions */}
        <div className="flex gap-2">
          <button
            onClick={() => { setShowLogForm(true); document.getElementById('log-section')?.scrollIntoView({ behavior: 'smooth' }); }}
            className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            📝 Log Hangout
          </button>
          <Link
            to="/friends"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-slotted-300"
          >
            👋 Invite Friend
          </Link>
        </div>
      </div>

      {/* Calendar just connected toast */}
      {calendarJustConnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-in fade-in">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-emerald-700">Calendar connected! Slotted will now use your availability.</p>
        </div>
      )}

      {/* ─── STATS ROW ─── */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Link to="/friends" className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 text-center">
          <p className="text-3xl font-bold text-gray-900">{stats.totalFriends}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mt-1">Friends</p>
        </Link>
        <div className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-gray-900">{stats.hangoutsThisMonth}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mt-1">This Month</p>
        </div>
        <div className="rounded-2xl border border-gray-200/60 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-gray-900">
            {syncing ? (
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            ) : calendarConnected ? '✅' : '–'}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mt-1">
            {calendarConnected ? 'Cal synced' : 'Calendar'}
          </p>
        </div>
      </div>

      {/* ─── PEOPLE TO SEE ─── */}
      {friendsToSee.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">👋</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">People to See</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {friendsToSee.slice(0, 10).map((f) => {
              const localTime = friendLocalTime(f.timezone);
              const typeBadge = TYPE_BADGE[f.friendshipType] || TYPE_BADGE.local;
              const isLongDistance = f.friendshipType === 'long_distance' || f.friendshipType === 'both';
              return (
                <Link
                  key={f.id}
                  to="/friends"
                  className="flex-shrink-0 w-[140px] rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 text-center"
                >
                  {f.photoUrl ? (
                    <img src={f.photoUrl} alt="" className="mx-auto h-12 w-12 rounded-full ring-2 ring-white shadow-sm" />
                  ) : (
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-lg font-semibold text-white shadow-sm">
                      {f.displayName?.[0] ?? '?'}
                    </div>
                  )}
                  <p className="mt-2 text-xs font-semibold text-gray-900 truncate">{f.displayName?.split(' ')[0]}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {f.lastHangout ? timeAgo(f.lastHangout) : "Haven't hung out"}
                  </p>
                  {isLongDistance && localTime && (
                    <p className="text-[10px] text-gray-400">🕐 {localTime}</p>
                  )}
                  {isLongDistance && (
                    <p className="mt-0.5 text-[9px] text-blue-500 font-medium">{typeBadge.emoji} {typeBadge.label}</p>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── UPCOMING HANGOUTS ─── */}
      {upcoming.length > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🗓️</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Upcoming</h2>
            <span className="ml-auto rounded-full bg-slotted-100 px-2 py-0.5 text-[10px] font-semibold text-slotted-700">{upcoming.length}</span>
          </div>
          <div className="space-y-2">
            {upcoming.slice(0, 4).map((m) => {
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

      {/* ─── CALENDAR ─── */}
      {calendarConnected && (
        <div className="mb-6 rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📅</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">My Calendar</h2>
            </div>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              {(['WEEK', 'MONTH'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setCalView(v)}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                    calView === v
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {v === 'WEEK' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
          </div>
          <div className={calView === 'WEEK' ? 'h-[500px]' : 'h-[600px]'}>
            <iframe
              src={calendarUrl}
              className="h-full w-full border-0"
              title="Google Calendar"
            />
          </div>
        </div>
      )}

      {/* ─── HANGOUT HISTORY + LOG ─── */}
      <div id="log-section" className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📝</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Hangout History</h2>
          </div>
          {!showLogForm && (
            <button
              onClick={() => setShowLogForm(true)}
              className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              + Log
            </button>
          )}
        </div>

        {/* Auto-detected hangouts */}
        {calendarConnected && pastConfirmed.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-gray-400">
              Auto-detected from your calendar
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

        {/* Empty states */}
        {calendarConnected && pastConfirmed.filter((m) => m.status !== 'didnt_happen').length === 0 && !showLogForm && (
          <p className="mt-3 text-xs text-gray-400">
            No hangouts detected yet — when you and a friend both accept a meetup, it appears here automatically.
          </p>
        )}
        {!calendarConnected && !showLogForm && pastConfirmed.length === 0 && (
          <p className="mt-3 text-xs text-gray-400">
            Log your hangouts so Slotted can learn your preferences.
          </p>
        )}

        {/* Manual log button for calendar users */}
        {calendarConnected && !showLogForm && (
          <button
            onClick={() => setShowLogForm(true)}
            className="mt-3 text-[11px] font-medium text-gray-400 hover:text-slotted-600 transition-colors"
          >
            + Log manually (for meetups not on calendar)
          </button>
        )}

        {/* Manual log form */}
        {showLogForm && (
          <div className="mt-4 space-y-4">
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
            <div className="flex items-center gap-3 pt-1">
              <button
                disabled={logSaving}
                onClick={async () => {
                  setLogSaving(true);
                  try {
                    await api.post('/meetup-logs', {
                      activity_type: logActivity,
                      duration_min: logDuration,
                      day_of_week: new Date().getDay(),
                      time_of_day: logTimeOfDay,
                      rating: logRating || null,
                    });
                    setLogSaved(true);
                    setTimeout(() => { setLogSaved(false); setShowLogForm(false); }, 2000);
                  } catch { /* silent */ }
                  finally { setLogSaving(false); }
                }}
                className={`rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  logSaved ? 'bg-emerald-500' : 'gradient-btn'
                }`}
              >
                {logSaving ? 'Saving...' : logSaved ? 'Logged! ✓' : 'Save Hangout'}
              </button>
              <button onClick={() => setShowLogForm(false)} className="text-xs text-gray-400 hover:text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Connect calendar CTA (only if no calendar) */}
      {!calendarConnected && (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-6 text-center">
          <span className="text-3xl">📅</span>
          <p className="mt-2 text-sm font-medium text-gray-700">Connect your calendar</p>
          <p className="mt-1 text-xs text-gray-400">
            See your week at a glance and let Slotted auto-detect hangouts
          </p>
          <Link
            to="/settings"
            className="mt-3 inline-block rounded-xl gradient-btn px-5 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Connect in Settings →
          </Link>
        </div>
      )}
    </AppShell>
  );
}
