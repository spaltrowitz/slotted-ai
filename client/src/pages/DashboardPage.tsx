import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

/* ─── types ─── */
interface ActivityFeedItem {
  type: 'overdue_friends' | 'recent_activity' | 'free_weekend';
  priority: number;
  friendId: string;
  friendName: string;
  friendPhoto?: string;
  message: string;
  timestamp?: string;
  activityType?: string;
}

/* ─── constants ─── */
const ACTIVITY_OPTIONS = [
  { value: 'coffee', emoji: '☕', label: 'Coffee', virtual: false },
  { value: 'meal', emoji: '🍽️', label: 'Meal', virtual: false },
  { value: 'drinks', emoji: '🍻', label: 'Drinks', virtual: false },
  { value: 'walk', emoji: '🚶', label: 'Walk', virtual: false },
  { value: 'workout', emoji: '💪', label: 'Workout', virtual: false },
  { value: 'movie', emoji: '🎬', label: 'Movie', virtual: false },
  { value: 'game_night', emoji: '🎮', label: 'Game Night', virtual: false },
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
  created_by: string;
  participants: { userId: string; displayName: string; photoUrl: string | null; rsvp: string }[];
  myRsvp: string;
}
interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  source: 'google' | 'apple';
  calendarName: string;
  color: string | null;
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

/** Check if a calendar event is a Slotted trip buffer */
const isBufferEvent = (ev: CalEvent) => ev.id?.startsWith('buffer_') ?? false;

const TYPE_BADGE: Record<string, { emoji: string; label: string }> = {
  local: { emoji: '📍', label: 'Local' },
  long_distance: { emoji: '📞', label: 'Long distance' },
  both: { emoji: '🌐', label: 'Both' },
};

/* ─── component ─── */
export default function DashboardPage() {
  const { user, calendarConnected, calendarJustConnected } = useAuth();

  // Calendar view state
  const [calView, setCalView] = useState<'agenda' | 'week' | 'month'>('month');
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calEventsLoading, setCalEventsLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, 1 = next week, etc.
  const [monthOffset, setMonthOffset] = useState(0); // 0 = this month, 1 = next month, etc.

  // Dashboard data
  const [friendsToSee, setFriendsToSee] = useState<FriendToSee[]>([]);

  const [activities, setActivities] = useState<ActivityFeedItem[]>([]);
  const [dismissingActivity, setDismissingActivity] = useState<string | null>(null);

  // Meetups
  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [didntHappenId, setDidntHappenId] = useState<string | null>(null);
  const [reasonSaving, setReasonSaving] = useState(false);
  const [cancellingMeetupId, setCancellingMeetupId] = useState<string | null>(null);
  const [expandedMeetupId, setExpandedMeetupId] = useState<string | null>(null);

  // Calendar sync

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
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [calSynced, setCalSynced] = useState(false);

  // Load core dashboard data once when user is available
  useEffect(() => {
    if (!user || dashboardLoaded) return;
    let cancelled = false;
    setDashboardLoading(true);

    (async () => {
      try {
        const [dashRes, activityRes, meetupsRes] = await Promise.allSettled([
          api.get('/dashboard'),
          api.get('/activity-feed'),
          api.get('/meetups'),
        ]);

        if (cancelled) return;
        if (dashRes.status === 'fulfilled') setFriendsToSee(dashRes.value.data.friendsToSee || []);
        if (activityRes.status === 'fulfilled') setActivities(activityRes.value.data.activities || []);
        if (meetupsRes.status === 'fulfilled') setMeetups(meetupsRes.value.data.meetups || []);
        setDashboardLoaded(true);
      } catch { /* network error */ }
      finally { if (!cancelled) setDashboardLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [user, dashboardLoaded]);

  // Calendar: sync once, then fetch events
  useEffect(() => {
    if (!user || !calendarConnected) return;
    if (calSynced) return; // only sync once per session
    let cancelled = false;

    (async () => {
      try {
        await api.post('/calendar/sync').catch(() => {});
        if (!cancelled) setCalSynced(true);
      } catch { /* silent */ }
    })();

    return () => { cancelled = true; };
  }, [user, calendarConnected, calSynced]);

  // Fetch calendar events (depends on view/offset, re-runs when those change)
  useEffect(() => {
    if (!user || !calendarConnected) return;
    let cancelled = false;

    (async () => {
      setCalEventsLoading(true);
      try {
        let fetchDays = 14;
        if (calView === 'month') {
          const ref = new Date();
          ref.setMonth(ref.getMonth() + monthOffset);
          const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 6);
          fetchDays = Math.ceil((monthEnd.getTime() - new Date().getTime()) / 86400000);
          if (fetchDays < 1) fetchDays = 1;
        }
        const { data } = await api.get(`/calendar/events?days=${fetchDays}`);
        if (!cancelled) setCalEvents(data.events || []);
      } catch { /* silent */ }
      finally { if (!cancelled) setCalEventsLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [user, calendarConnected, calView, monthOffset]);

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

  const handleCancelMeetup = async (meetupId: string) => {
    if (!window.confirm('Cancel this hangout? The other person will be notified.')) return;
    setCancellingMeetupId(meetupId);
    try {
      await api.patch(`/meetups/${meetupId}/rsvp`, { rsvp: 'declined' });
      setMeetups((prev) => prev.map((m) => m.id === meetupId ? { ...m, myRsvp: 'declined', status: 'cancelled' } : m));
    } catch { /* silent */ }
    finally { setCancellingMeetupId(null); }
  };

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

  /* helper: get the date string (YYYY-MM-DD) for an event's start, handling all-day vs timed */
  const eventDateStr = (isoStr: string, isAllDay: boolean) => {
    // All-day events come as "YYYY-MM-DD" (no timezone), timed events as full ISO
    if (isAllDay && isoStr.length === 10) return isoStr;
    return new Date(isoStr).toLocaleDateString('en-CA');
  };

  const eventEndDateStr = (isoStr: string, isAllDay: boolean) => {
    if (isAllDay && isoStr.length === 10) return isoStr;
    return new Date(isoStr).toLocaleDateString('en-CA');
  };

  /* event falls on a given date (handles multi-day) */
  const eventOnDate = (ev: CalEvent, dateStr: string) => {
    const evStart = eventDateStr(ev.start, ev.allDay);
    const evEnd = eventEndDateStr(ev.end, ev.allDay);
    // For all-day events, end date in iCal is exclusive (day after last day)
    // So a Feb 26-Mar 1 trip has end = Mar 2
    return dateStr >= evStart && dateStr < evEnd;
  };

  /* ─── group events by date (expand multi-day into each day) ─── */
  const groupedEvents = useMemo(() => {
    const groups: Record<string, CalEvent[]> = {};
    for (const ev of calEvents) {
      const startKey = eventDateStr(ev.start, ev.allDay);
      const endKey = eventEndDateStr(ev.end, ev.allDay);

      // For multi-day events, add to each day (cap at 60 to prevent infinite loops from bad data)
      let cursor = startKey;
      let safety = 0;
      while (cursor < endKey && safety < 60) {
        if (!groups[cursor]) groups[cursor] = [];
        groups[cursor].push(ev);
        // Advance one day
        const d = new Date(cursor + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        cursor = d.toLocaleDateString('en-CA');
        safety++;
      }

      // For timed events that don't span days, ensure at least start is included
      if (!ev.allDay && startKey === endKey) {
        if (!groups[startKey]) groups[startKey] = [];
        if (!groups[startKey].includes(ev)) groups[startKey].push(ev);
      }
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [calEvents]);

  const formatEventTime = (start: string, end: string, allDay: boolean) => {
    if (allDay) return 'All day';
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} – ${e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  };

  const formatDateHeader = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const todayStr = new Date().toLocaleDateString('en-CA');
    const tomorrowStr = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
    if (dateStr === todayStr) return 'Today';
    if (dateStr === tomorrowStr) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  /* ─── week view helpers ─── */
  const weekDays = useMemo(() => {
    const today = new Date();
    // Start from today + offset (so today is always on the left)
    const startDay = new Date(today);
    startDay.setDate(today.getDate() + (weekOffset * 7));
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + i);
      days.push(d.toLocaleDateString('en-CA'));
    }
    return days;
  }, [weekOffset]);

  const weekLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const s = new Date(weekDays[0] + 'T12:00:00');
    const e = new Date(weekDays[6] + 'T12:00:00');
    if (s.getMonth() === e.getMonth()) {
      return `${s.toLocaleDateString('en-US', { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [weekDays]);

  const eventsForDate = (dateStr: string) =>
    calEvents.filter((ev) => eventOnDate(ev, dateStr));

  /* ─── time-grid helpers for week view ─── */
  const HOUR_HEIGHT = 48; // px per hour in time grid
  const START_HOUR = 7; // 7 AM
  const END_HOUR = 23; // 11 PM
  const TOTAL_HOURS = END_HOUR - START_HOUR;
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  const eventStyle = (ev: CalEvent) => {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = e.getHours() * 60 + e.getMinutes();
    const clampedStart = Math.max(startMin, START_HOUR * 60);
    const clampedEnd = Math.min(endMin || END_HOUR * 60, END_HOUR * 60);
    const top = ((clampedStart - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 20);
    return { top, height };
  };

  const allDayEventsForDate = (dateStr: string) =>
    calEvents.filter((ev) => ev.allDay && eventOnDate(ev, dateStr));
  const timedEventsForDate = (dateStr: string) =>
    calEvents.filter((ev) => !ev.allDay && eventOnDate(ev, dateStr));

  /* ─── month view helpers ─── */
  const monthViewDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const monthGrid = useMemo(() => {
    const year = monthViewDate.getFullYear();
    const month = monthViewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = new Date(firstDay);
    startDay.setDate(1 - firstDay.getDay()); // back to Sunday
    const weeks: string[][] = [];
    let cursor = new Date(startDay);
    for (let w = 0; w < 6; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(cursor.toLocaleDateString('en-CA'));
        cursor = new Date(cursor.getTime() + 86400000);
      }
      weeks.push(week);
    }
    return weeks;
  }, [monthViewDate]);

  const currentMonth = monthViewDate.getMonth();

  const monthLabel = monthViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  /* ─── today at a glance ─── */
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayEvents = calEvents.filter((ev) => eventOnDate(ev, todayStr) && !isBufferEvent(ev));
  const nextEvent = todayEvents
    .filter((ev) => !ev.allDay && new Date(ev.start) > new Date())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  const todaySummary = (() => {
    const parts: string[] = [];
    if (todayEvents.length > 0) parts.push(`${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''} today`);
    if (upcoming.length > 0) parts.push(`${upcoming.length} upcoming hangout${upcoming.length !== 1 ? 's' : ''}`);
    if (nextEvent) {
      const t = new Date(nextEvent.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      parts.push(`Next: ${nextEvent.title.length > 20 ? nextEvent.title.slice(0, 20) + '…' : nextEvent.title} at ${t}`);
    }
    if (parts.length === 0 && friendsToSee.length > 0) parts.push(`${friendsToSee.length} friend${friendsToSee.length !== 1 ? 's' : ''} to catch up with`);
    return parts.join(' · ');
  })();

  /* ─── should show history section? ─── */
  // const hasHistory = pastConfirmed.filter((m) => m.status !== 'didnt_happen').length > 0;

  console.log('[Dashboard render]', { dashboardLoading, dashboardLoaded, calSynced, calEventsLoading, friendsToSee: friendsToSee.length, calEvents: calEvents.length, meetups: meetups.length });

  return (
    <AppShell>
      {/* ─── HEADER ─── */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
            {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
          </h1>
          {/* Quick actions */}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowLogForm(true); document.getElementById('log-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              📝 Log
            </button>
            <Link
              to="/friends"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-slotted-300"
            >
              👋 Invite
            </Link>
          </div>
        </div>
        {!dashboardLoading && todaySummary && (
          <p className="mt-1 text-xs text-gray-400">{todaySummary}</p>
        )}
      </div>

      {/* Calendar just connected toast */}
      {calendarJustConnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-in fade-in">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-emerald-700">Calendar connected!</p>
        </div>
      )}

      {/* Calendar connected but no events — nudge to select calendars */}
      {calendarConnected && calSynced && !calEventsLoading && calEvents.length === 0 && !calendarJustConnected && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-lg">📅</span>
          <p className="text-sm text-amber-800">
            Your calendar is connected but no events are showing up.{' '}
            <Link to="/settings" className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700">
              Go to Settings
            </Link>{' '}
            to make sure you've selected the specific calendars you want to sync.
          </p>
        </div>
      )}

      {/* ─── LOADING SKELETON ─── */}
      {dashboardLoading && (
        <div className="mb-6 space-y-4 animate-pulse">
          <div className="flex gap-3 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex-shrink-0 w-[140px] rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-200" />
                <div className="mt-2 mx-auto h-3 w-16 rounded bg-gray-200" />
                <div className="mt-1 mx-auto h-2 w-20 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── PEOPLE TO SEE ─── */}
      {!dashboardLoading && friendsToSee.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">👋</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">People to See</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide" style={{ maxHeight: '160px' }}>
            {friendsToSee.slice(0, 10).map((f) => {
              const localTime = friendLocalTime(f.timezone);
              const typeBadge = TYPE_BADGE[f.friendshipType] || TYPE_BADGE.local;
              const isLongDistance = f.friendshipType === 'long_distance' || f.friendshipType === 'both';
              return (
                <Link
                  key={f.id}
                  to={`/friends?findTimes=${f.id}`}
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

      {/* ─── ACTIVITY FEED ─── */}
      {activities.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">✨</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Activity</h2>
          </div>
          <div className="space-y-3">
            {activities.map((activity, index) => {
              const activityIcon = {
                overdue_friends: "⏰",
                recent_activity: "✨",
                free_weekend: "📅",
              }[activity.type] || "💬";

              const activityKey = `${activity.type}-${activity.friendId}-${index}`;

              return (
                <div
                  key={activityKey}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors relative group"
                >
                  {activity.friendPhoto ? (
                    <img
                      src={activity.friendPhoto}
                      alt={activity.friendName}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">{activityIcon}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{activity.message}</p>
                    {activity.timestamp && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {timeAgo(activity.timestamp)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      if (!user) return;
                      setDismissingActivity(activityKey);
                      // Optimistically remove from UI
                      setActivities(prev => prev.filter((_, i) => i !== index));
                      // Send to backend
                      try {
                        const token = await user.getIdToken();
                        await fetch('/api/activity-feed/dismiss', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ activityType: activity.type, friendId: activity.friendId }),
                        });
                      } catch (err) {
                        console.error('Failed to dismiss activity:', err);
                        // Could restore the item here if needed
                      } finally {
                        setDismissingActivity(null);
                      }
                    }}
                    disabled={dismissingActivity === activityKey}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 p-1"
                    title="Dismiss"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
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
              const isExpanded = expandedMeetupId === m.id;
              const friendId = others.length === 1 ? others[0].userId : null;
              return (
                <div key={m.id} className="rounded-xl border border-gray-100 bg-gray-50/30 overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedMeetupId(isExpanded ? null : m.id)}
                  >
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
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${
                        m.myRsvp === 'accepted'
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                          : m.myRsvp === 'pending'
                            ? 'border border-amber-200 bg-amber-50 text-amber-700'
                            : 'border border-gray-200 bg-gray-50 text-gray-500'
                      }`}>
                        {m.myRsvp === 'accepted' ? '✅ Confirmed' : m.myRsvp === 'pending' ? '⏳ Pending' : m.myRsvp}
                      </span>
                      <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
                      {friendId && (
                        <Link
                          to={`/friends?findTimes=${friendId}`}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-slotted-300 transition-all"
                        >
                          🔄 Find new time
                        </Link>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCancelMeetup(m.id); }}
                        disabled={cancellingMeetupId === m.id}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                      >
                        {cancellingMeetupId === m.id ? 'Cancelling…' : '✕ Cancel'}
                      </button>
                    </div>
                  )}
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
              {(['week', 'month', 'agenda'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setCalView(v); if (v === 'week') setWeekOffset(0); }}
                  className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                    calView === v
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {v === 'week' ? 'Week' : v === 'month' ? 'Month' : 'Agenda'}
                </button>
              ))}
            </div>
          </div>

          {/* Week navigation bar */}
          {calView === 'week' && (
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-2">
              <button onClick={() => setWeekOffset((o) => o - 1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button onClick={() => setWeekOffset(0)} className="text-xs font-semibold text-gray-600 hover:text-slotted-600 transition-colors">
                {weekOffset === 0 ? 'This Week' : weekLabel}
              </button>
              <button onClick={() => setWeekOffset((o) => o + 1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          )}

          {calEventsLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
              <span className="ml-2 text-sm text-gray-400">Loading events...</span>
            </div>
          ) : calView === 'week' ? (
            /* ──── WEEK TIME-GRID VIEW (Google Calendar style) ──── */
            <div>
              {/* All-day events row */}
              {weekDays.some((d) => allDayEventsForDate(d).length > 0) && (
                <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
                  <div className="border-r border-gray-100 flex items-center justify-center">
                    <span className="text-[9px] text-gray-300">ALL DAY</span>
                  </div>
                  {weekDays.map((dateStr) => {
                    const adEvents = allDayEventsForDate(dateStr);
                    return (
                      <div key={dateStr} className="border-r border-gray-50 last:border-r-0 px-0.5 py-1 min-h-[28px]">
                        {adEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className={`rounded px-1 py-0.5 text-[9px] font-medium truncate mb-0.5 ${isBufferEvent(ev) ? 'border border-dashed border-slate-400' : ''}`}
                            style={{
                              backgroundColor: isBufferEvent(ev) ? '#f1f5f9' : (ev.color || (ev.source === 'apple' ? '#ff3b30' : '#4285f4')),
                              color: isBufferEvent(ev) ? '#64748b' : '#fff',
                              backgroundImage: isBufferEvent(ev) ? 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(148,163,184,0.2) 3px, rgba(148,163,184,0.2) 5px)' : undefined,
                            }}
                            title={ev.title}
                          >
                            {isBufferEvent(ev) ? '' : (ev.source === 'apple' ? '🍎 ' : '📧 ')}{ev.title}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Day headers */}
              <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
                <div className="border-r border-gray-100" />
                {weekDays.map((dateStr) => {
                  const d = new Date(dateStr + 'T12:00:00');
                  const isToday = dateStr === new Date().toLocaleDateString('en-CA');
                  return (
                    <div key={dateStr} className={`py-2 text-center border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-slotted-50/50' : ''}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {d.toLocaleDateString('en-US', { weekday: 'short' })}
                      </p>
                      <p className={`text-lg font-bold leading-tight ${isToday ? 'bg-slotted-500 text-white rounded-full w-8 h-8 flex items-center justify-center mx-auto' : 'text-gray-700'}`}>
                        {d.getDate()}
                      </p>
                    </div>
                  );
                })}
              </div>
              {/* Time grid */}
              <div className="overflow-y-auto max-h-[520px]" style={{ scrollbarWidth: 'thin' }}>
                <div className="grid relative" style={{ gridTemplateColumns: '48px repeat(7, 1fr)', height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
                  {/* Hour labels + grid lines */}
                  <div className="relative border-r border-gray-100">
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="absolute w-full text-right pr-2"
                        style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                      >
                        <span className="text-[10px] text-gray-400 -translate-y-1/2 inline-block">
                          {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Day columns */}
                  {weekDays.map((dateStr) => {
                    const isToday = dateStr === new Date().toLocaleDateString('en-CA');
                    const dayTimedEvents = timedEventsForDate(dateStr);
                    return (
                      <div key={dateStr} className={`relative border-r border-gray-50 last:border-r-0 ${isToday ? 'bg-slotted-50/20' : ''}`}>
                        {/* Hour gridlines */}
                        {hours.map((h) => (
                          <div
                            key={h}
                            className="absolute w-full border-t border-gray-100"
                            style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
                          />
                        ))}
                        {/* Current time indicator */}
                        {isToday && (() => {
                          const now = new Date();
                          const nowMin = now.getHours() * 60 + now.getMinutes();
                          if (nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60) {
                            const top = ((nowMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                            return (
                              <div className="absolute w-full z-20" style={{ top: `${top}px` }}>
                                <div className="flex items-center">
                                  <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1" />
                                  <div className="flex-1 h-0.5 bg-red-500" />
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        {/* Events */}
                        {dayTimedEvents.map((ev) => {
                          const { top, height } = eventStyle(ev);
                          const isBuf = isBufferEvent(ev);
                          const bgColor = isBuf ? '#94a3b8' : (ev.color || (ev.source === 'apple' ? '#ff3b30' : '#4285f4'));
                          return (
                            <div
                              key={ev.id}
                              className={`absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 overflow-hidden cursor-default z-10 ${isBuf ? 'border-2 border-dashed border-slate-400' : 'border border-white/30'}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                backgroundColor: isBuf ? '#f1f5f9' : bgColor + 'dd',
                                backgroundImage: isBuf ? 'repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(148,163,184,0.15) 4px, rgba(148,163,184,0.15) 6px)' : undefined,
                                minHeight: '20px',
                              }}
                              title={`${ev.title}\n${formatEventTime(ev.start, ev.end, ev.allDay)}${ev.location ? '\n📍 ' + ev.location : ''}\n${isBuf ? '🗓️ Slotted' : (ev.source === 'apple' ? '🍎' : '📧') + ' ' + ev.calendarName}`}
                            >
                              <p className={`text-[10px] font-semibold truncate leading-tight ${isBuf ? 'text-slate-600' : 'text-white'}`}>{ev.title}</p>
                              {height >= 36 && (
                                <p className="text-[9px] text-white/80 truncate">
                                  {new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                </p>
                              )}
                              {height >= 52 && ev.location && (
                                <p className="text-[9px] text-white/70 truncate">📍 {ev.location}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : calView === 'month' ? (
            /* ──── MONTH VIEW ──── */
            <div>
              <div className="flex items-center justify-between px-5 py-2 border-b border-gray-100">
                <button onClick={() => setMonthOffset((o) => o - 1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button onClick={() => setMonthOffset(0)} className="text-xs font-semibold text-gray-600 hover:text-slotted-600 transition-colors">
                  {monthLabel}
                </button>
                <button onClick={() => setMonthOffset((o) => o + 1)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 border-b border-gray-100">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1.5 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{d}</p>
                  </div>
                ))}
              </div>
              {/* Month grid */}
              {monthGrid.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
                  {week.map((dateStr) => {
                    const d = new Date(dateStr + 'T12:00:00');
                    const isToday = dateStr === new Date().toLocaleDateString('en-CA');
                    const isCurrentMonth = d.getMonth() === currentMonth;
                    const dayEvents = eventsForDate(dateStr);
                    return (
                      <div key={dateStr} className={`border-r border-gray-50 last:border-r-0 min-h-[72px] p-1 ${isToday ? 'bg-slotted-50/40' : !isCurrentMonth ? 'bg-gray-50/50' : ''}`}>
                        <p className={`text-[11px] font-semibold text-center ${
                          isToday ? 'text-white bg-slotted-500 rounded-full w-5 h-5 flex items-center justify-center mx-auto' :
                          isCurrentMonth ? 'text-gray-700' : 'text-gray-300'
                        }`}>
                          {d.getDate()}
                        </p>
                        <div className="mt-0.5 space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev) => {
                            const isBuf = isBufferEvent(ev);
                            return (
                            <div
                              key={ev.id}
                              className={`rounded px-1 py-0.5 text-[9px] leading-tight truncate ${isBuf ? 'border border-dashed border-slate-300' : ''}`}
                              style={{
                                backgroundColor: isBuf ? '#f1f5f920' : (ev.color || (ev.source === 'apple' ? '#ff3b30' : '#4285f4')) + '20',
                                color: isBuf ? '#64748b' : (ev.color || (ev.source === 'apple' ? '#ff3b30' : '#4285f4')),
                                backgroundImage: isBuf ? 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(148,163,184,0.15) 2px, rgba(148,163,184,0.15) 3px)' : undefined,
                              }}
                              title={`${ev.title} — ${formatEventTime(ev.start, ev.end, ev.allDay)}`}
                            >
                              {ev.title}
                            </div>
                            );
                          })}
                          {dayEvents.length > 3 && (
                            <p className="text-[8px] text-gray-400 text-center">+{dayEvents.length - 3}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            /* ──── AGENDA VIEW ──── */
            calEvents.length === 0 ? (
              <div className="py-10 text-center">
                <span className="text-3xl">📭</span>
                <p className="mt-2 text-sm text-gray-500">No upcoming events</p>
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                {groupedEvents.map(([dateStr, events]) => (
                  <div key={dateStr}>
                    <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/90 px-5 py-2 backdrop-blur-sm">
                      <p className="text-xs font-semibold text-gray-500">{formatDateHeader(dateStr)}</p>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {events.map((ev) => (
                        <div key={ev.id} className={`flex items-start gap-3 px-5 py-3 transition-colors ${isBufferEvent(ev) ? 'bg-slate-50/60' : 'hover:bg-gray-50/50'}`} style={isBufferEvent(ev) ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(148,163,184,0.08) 6px, rgba(148,163,184,0.08) 8px)' } : undefined}>
                          <div
                            className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 ${isBufferEvent(ev) ? 'rounded border-2 border-dashed border-slate-400' : 'rounded-full'}`}
                            style={isBufferEvent(ev) ? {} : { backgroundColor: ev.color || (ev.source === 'apple' ? '#ff3b30' : '#4285f4') }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isBufferEvent(ev) ? 'text-slate-600' : 'text-gray-900'}`}>{ev.title}</p>
                            <p className="text-[11px] text-gray-400">
                              {isBufferEvent(ev) ? 'Blocked by Slotted' : formatEventTime(ev.start, ev.end, ev.allDay)}
                            </p>
                            {ev.location && (
                              <p className="text-[11px] text-gray-400 truncate">📍 {ev.location}</p>
                            )}
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                            isBufferEvent(ev)
                              ? 'bg-slate-100 text-slate-500 border border-dashed border-slate-300'
                              : ev.source === 'apple'
                                ? 'bg-gray-100 text-gray-500'
                                : 'bg-blue-50 text-blue-500'
                          }`}>
                            {isBufferEvent(ev) ? '🗓️ Slotted' : (ev.source === 'apple' ? '🍎' : '📧') + ' ' + ((ev.calendarName || '').length > 12 ? (ev.calendarName || '').slice(0, 12) + '…' : (ev.calendarName || 'Calendar'))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
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
            No hangouts detected yet.
          </p>
        )}
        {!calendarConnected && !showLogForm && pastConfirmed.length === 0 && (
          <p className="mt-3 text-xs text-gray-400">
            Log hangouts to help Slotted learn your preferences.
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
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Activity</label>
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
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Duration</label>
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
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Time</label>
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
            <div>
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
              <p className="text-[10px] text-gray-400 mt-0.5">Only visible to you</p>
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
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-5 text-center">
          <span className="text-2xl">📅</span>
          <p className="mt-1.5 text-sm font-medium text-gray-700">Connect your calendar</p>
          <Link
            to="/settings"
            className="mt-2 inline-block rounded-xl gradient-btn px-5 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Connect →
          </Link>
        </div>
      )}
    </AppShell>
  );
}
