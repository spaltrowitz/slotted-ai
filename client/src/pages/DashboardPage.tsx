import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import AddToCalendarModal from '../components/AddToCalendarModal';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import {
  fetchActivityFeed,
  fetchCalendarEvents,
  fetchDashboard,
  fetchEventSuggestions,
  fetchFriends,
  fetchMeetups,
  fetchSavedEvents,
  queryKeys,
  type ActivityFeedItem,
  type CalendarEvent,
  type Meetup,
} from '../lib/queries';

/** Responsive breakpoint — true when viewport < 640px */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
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

type CalEvent = CalendarEvent;

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

/** Check if a calendar event is a Slotted trip buffer */
const isBufferEvent = (ev: CalEvent) => ev.id?.startsWith('buffer_') ?? false;

function HowItWorks() {
  const [open, setOpen] = useState(false);

  const steps = [
    { emoji: '1️⃣', title: 'Invite a friend', desc: 'Share your invite link via text, email, or copy link. They\'ll get a friend request when they sign up.' },
    { emoji: '2️⃣', title: 'Connect calendars', desc: 'Both you and your friend connect a Google or Apple calendar in Settings so Slotted.ai can find free times. Tip: Ask your friends to connect their calendar too — Slotted.ai works best when both sides are synced!' },
    { emoji: '3️⃣', title: 'Find times', desc: 'Tap "Find times" on a friend — then choose In Person, Phone Call, or Video Call. Slotted.ai finds the best slots for each type (calls can be shorter and skip travel time).' },
    { emoji: '4️⃣', title: 'Book it', desc: 'Pick a time and hit "Book it." Your friend gets a notification in their inbox to accept or decline.' },
    { emoji: '5️⃣', title: 'Add to calendar', desc: 'After booking (or accepting), you\'ll both be prompted to save the event to a specific Google or Apple calendar.' },
  ];

  return (
    <div className="mb-4 sm:mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-2xl border border-slotted-100 bg-gradient-to-r from-slotted-50/40 to-purple-50/30 px-5 py-3 text-left transition-all hover:shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">💡</span>
          <span className="text-sm font-semibold text-gray-800">How Slotted.ai works</span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4 animate-in slide-in-from-top-2 fade-in">
          {steps.map((s) => (
            <div key={s.title} className="flex gap-3">
              <span className="text-lg flex-shrink-0 mt-0.5">{s.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
          {!window.matchMedia('(display-mode: standalone)').matches && !(window.navigator as any).standalone && (
            <div className="rounded-xl bg-slotted-50 border border-slotted-200 px-4 py-2.5">
              <p className="text-[11px] text-slotted-700 leading-relaxed">
                <span className="font-semibold">📲 Install the app:</span> Add Slotted.ai to your home screen for the best experience. Go to{' '}
                <Link to="/settings" className="underline font-medium hover:text-slotted-800">Settings</Link>{' '}
                to see install instructions for your device.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── component ─── */
export default function DashboardPage() {
  const { user, calendarConnected, calendarJustConnected } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  // Dashboard data
  const [dismissingActivity, setDismissingActivity] = useState<string | null>(null);

  // Meetups
  const [didntHappenId, setDidntHappenId] = useState<string | null>(null);
  const [cancellingMeetupId, setCancellingMeetupId] = useState<string | null>(null);
  const [expandedMeetupId, setExpandedMeetupId] = useState<string | null>(null);
  const [acceptingMeetupId, setAcceptingMeetupId] = useState<string | null>(null);
  const [calendarModal, setCalendarModal] = useState<{ meetupId: string; title: string; startTime: string; endTime: string } | null>(null);
  const [sharingMeetupId, setSharingMeetupId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Calendar sync

  // Log form
  const [showLogForm, setShowLogForm] = useState(false);
  const [logActivity, setLogActivity] = useState('');
  const [logDuration, setLogDuration] = useState<number | null>(null);
  const [logTimeOfDay, setLogTimeOfDay] = useState('');
  const [logRating, setLogRating] = useState(0);
  const [logSaved, setLogSaved] = useState(false);
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logFriendId, setLogFriendId] = useState<string>('');
  const [logFriendName, setLogFriendName] = useState('');

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const timeEmoji =
    today.getHours() < 12 ? '☀️' : today.getHours() < 18 ? '🌤️' : '🌙';

  /* ─── data fetching ─── */
  const userUid = user?.uid;

  const { data: friendsToSee = [], isLoading: dashboardLoading } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: fetchDashboard,
    enabled: !!userUid,
  });

  const { data: activities = [] } = useQuery({
    queryKey: queryKeys.activityFeed,
    queryFn: fetchActivityFeed,
    enabled: !!userUid,
  });

  const { data: meetups = [] } = useQuery({
    queryKey: queryKeys.meetups,
    queryFn: fetchMeetups,
    enabled: !!userUid,
  });

  const { data: friendsData = [] } = useQuery({
    queryKey: queryKeys.friends,
    queryFn: fetchFriends,
    enabled: !!userUid,
  });

  const { data: eventSuggestions = [] } = useQuery({
    queryKey: queryKeys.events.suggestions,
    queryFn: fetchEventSuggestions,
    enabled: !!userUid,
  });

  const { data: savedEventsData = [] } = useQuery({
    queryKey: queryKeys.events.saved,
    queryFn: fetchSavedEvents,
    enabled: !!userUid,
  });

  const savedEvents = useMemo(() => savedEventsData.slice(0, 5), [savedEventsData]);

  const allFriends = useMemo(() => {
    return friendsData
      .filter((f) => f.status === 'accepted')
      .map((f) => ({ id: f.friend.id, displayName: f.friend.displayName, photoUrl: f.friend.photoUrl || null }));
  }, [friendsData]);

  const {
    data: calEvents = [],
  } = useQuery({
    queryKey: queryKeys.calendarEvents(14, calendarConnected),
    queryFn: () => fetchCalendarEvents(14),
    enabled: !!userUid,
  });

  const updateMeetupRsvpMutation = useMutation({
    mutationFn: async ({ meetupId, rsvp }: { meetupId: string; rsvp: 'accepted' | 'declined' }) => {
      const { data } = await api.patch(`/meetups/${meetupId}/rsvp`, { rsvp });
      return data as { meetupConfirmed?: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetups });
    },
  });

  const markMeetupDidntHappenMutation = useMutation({
    mutationFn: async ({ meetupId, reason }: { meetupId: string; reason: string }) => {
      await api.patch(`/meetups/${meetupId}/didnt-happen`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetups });
    },
  });

  const shareMeetupMutation = useMutation({
    mutationFn: async (meetupId: string) => {
      const { data } = await api.post(`/meetups/${meetupId}/share`);
      return data as { shareUrl: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetups });
    },
  });

  const logMeetupMutation = useMutation({
    mutationFn: async (payload: {
      activity_type: string | null;
      duration_min: number | null;
      day_of_week: number;
      time_of_day: string | null;
      rating: number | null;
      hangout_date: string;
      friend_id: string | null;
      friend_name: string | null;
    }) => {
      await api.post('/meetup-logs', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed });
    },
  });

  const dismissActivityMutation = useMutation({
    mutationFn: async ({ activityType, friendId }: { activityType: ActivityFeedItem['type']; friendId: string }) => {
      await api.post('/activity-feed/dismiss', { activityType, friendId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed });
    },
  });

  const reasonSaving = markMeetupDidntHappenMutation.isPending;
  const logSaving = logMeetupMutation.isPending;

  /* ─── derived ─── */
  const currentUserId = user?.uid?.replace(/^firebase_/, '') || '';
  const now = useMemo(() => new Date(), []);
  const upcoming = meetups.filter((m) => {
    const start = new Date(m.start_time);
    return start >= now && !['cancelled', 'didnt_happen', 'declined'].includes(m.status) && m.myRsvp !== 'declined';
  });
  // Confirmed = meetup status is confirmed OR all participants accepted
  const confirmedHangouts = upcoming.filter((m) =>
    m.status === 'confirmed' || m.participants.every((p) => p.rsvp === 'accepted')
  );
  // Pending = not yet confirmed (someone hasn't accepted)
  const pendingHangouts = upcoming.filter((m) =>
    m.status !== 'confirmed' && !m.participants.every((p) => p.rsvp === 'accepted')
  );
  const upcomingByWeek = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();

    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - dayOfWeek);
    thisWeekStart.setHours(0, 0, 0, 0);

    const thisWeekEnd = new Date(thisWeekStart);
    thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
    thisWeekEnd.setHours(23, 59, 59, 999);

    const nextWeekStart = new Date(thisWeekEnd.getTime() + 1);
    nextWeekStart.setHours(0, 0, 0, 0);

    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
    nextWeekEnd.setHours(23, 59, 59, 999);

    const thisWeek = upcoming
      .filter((m) => {
        const start = new Date(m.start_time);
        return start >= thisWeekStart && start <= thisWeekEnd;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    const nextWeek = upcoming
      .filter((m) => {
        const start = new Date(m.start_time);
        return start >= nextWeekStart && start <= nextWeekEnd;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    return { thisWeek, nextWeek };
  }, [upcoming]);

  const pastConfirmed = meetups.filter((m) => {
    const end = new Date(m.end_time);
    return end < now && (m.status === 'confirmed' || (m.status === 'proposed' && m.myRsvp === 'accepted'));
  });

  const handleAcceptMeetup = async (meetupId: string) => {
    setAcceptingMeetupId(meetupId);
    try {
      const data = await updateMeetupRsvpMutation.mutateAsync({ meetupId, rsvp: 'accepted' });
      const currentMeetups = queryClient.getQueryData<Meetup[]>(queryKeys.meetups) ?? meetups;
      const updatedMeetups = currentMeetups.map((m) => {
        if (m.id !== meetupId) return m;
        const updatedParticipants = m.participants.map((p) =>
          p.userId === currentUserId ? { ...p, rsvp: 'accepted' } : p
        );
        const allAccepted = updatedParticipants.every((p) => p.rsvp === 'accepted');
        return {
          ...m,
          myRsvp: 'accepted',
          status: data.meetupConfirmed || allAccepted ? 'confirmed' : m.status,
          participants: updatedParticipants,
        };
      });
      queryClient.setQueryData(queryKeys.meetups, updatedMeetups);
      if (data.meetupConfirmed) {
        const meetup = updatedMeetups.find((m) => m.id === meetupId);
        if (meetup) {
          setCalendarModal({
            meetupId,
            title: meetup.title,
            startTime: meetup.start_time,
            endTime: meetup.end_time,
          });
        }
      }
    } catch {
      // silent
    } finally {
      setAcceptingMeetupId(null);
    }
  };

  const handleCancelMeetup = async (meetupId: string) => {
    if (!window.confirm('Cancel this hangout? The other person will be notified.')) return;
    setCancellingMeetupId(meetupId);
    try {
      await updateMeetupRsvpMutation.mutateAsync({ meetupId, rsvp: 'declined' });
      const currentMeetups = queryClient.getQueryData<Meetup[]>(queryKeys.meetups) ?? meetups;
      const updatedMeetups = currentMeetups.map((m) =>
        m.id === meetupId ? { ...m, myRsvp: 'declined', status: 'cancelled' } : m
      );
      queryClient.setQueryData(queryKeys.meetups, updatedMeetups);
    } catch {
      // silent
    } finally {
      setCancellingMeetupId(null);
    }
  };

  const handleDidntHappen = async (meetupId: string, reason: string) => {
    try {
      await markMeetupDidntHappenMutation.mutateAsync({ meetupId, reason });
      const currentMeetups = queryClient.getQueryData<Meetup[]>(queryKeys.meetups) ?? meetups;
      queryClient.setQueryData(
        queryKeys.meetups,
        currentMeetups.map((m) => (m.id === meetupId ? { ...m, status: 'didnt_happen' } : m)),
      );
      setDidntHappenId(null);
    } catch {
      // silent
    }
  };

  const formatMeetupTime = (start: string) => {
    const d = new Date(start);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const handleShareMeetup = async (meetupId: string, title: string) => {
    setSharingMeetupId(meetupId);
    setShareUrl(null);
    try {
      const data = await shareMeetupMutation.mutateAsync(meetupId);
      const url = data.shareUrl;
      setShareUrl(url);
      const message = `Hey! Here are the details for ${title || 'our hangout'} — add it to your calendar:\n${url}`;
      if (navigator.share) {
        await navigator.share({ title: title || 'Hangout', text: message, url });
        setSharingMeetupId(null);
        setShareUrl(null);
      } else {
        await navigator.clipboard.writeText(message);
      }
    } catch {
      // silent
    } finally {
      if (!navigator.share) {
        setTimeout(() => {
          setSharingMeetupId(null);
          setShareUrl(null);
        }, 2000);
      }
    }
  };

  const otherParticipants = (m: Meetup) =>
    m.participants.filter((p) => p.userId !== currentUserId);

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
    if (parts.length === 0 && allFriends.length === 0) parts.push('Invite friends to get started!');
    return parts.join(' · ');
  })();

  /* ─── should show history section? ─── */
  return (
    <AppShell>
      {/* ─── HEADER ─── */}
      <div className="mb-3 sm:mb-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 min-w-0 truncate">
            {greeting}, {user?.displayName?.split(' ')[0]} {timeEmoji}
          </h1>
          {/* Quick actions */}
          <div className="flex gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => { setShowLogForm(true); document.getElementById('log-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="rounded-xl gradient-btn px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              📝 Log
            </button>
            <Link
              to="/friends"
              className="rounded-xl border border-gray-200 bg-white px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-slotted-300"
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


      {/* ─── LOADING SKELETON ─── */}
      {dashboardLoading && (
        <div className="mb-6 space-y-5">
          {/* Greeting skeleton */}
          <div className="animate-pulse space-y-2">
            <div className="h-6 w-48 rounded-lg bg-gray-200/60" />
            <div className="h-4 w-32 rounded-lg bg-gray-100" />
          </div>

          {/* Calendar section skeleton — 3 day columns */}
          <div className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4">
            <div className="h-4 w-28 rounded bg-gray-200/60 mb-3" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((col) => (
                <div key={col} className="space-y-2">
                  <div className="h-3 w-12 rounded bg-gray-200/60 mx-auto" />
                  <div className="h-16 rounded-xl bg-gray-100" />
                  <div className="h-10 rounded-xl bg-gray-100" />
                </div>
              ))}
            </div>
          </div>

          {/* Friends section skeleton — 3 avatars */}
          <div className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4">
            <div className="h-4 w-24 rounded bg-gray-200/60 mb-3" />
            <div className="flex gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div className="h-10 w-10 rounded-full bg-gray-200/60" />
                  <div className="h-3 w-14 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>

          {/* Activity feed skeleton — 2 cards */}
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-20 rounded bg-gray-200/60" />
            {[0, 1].map((i) => (
              <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-gray-200/60 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/4 rounded bg-gray-200/60" />
                  <div className="h-3 w-1/2 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── NO UPCOMING HANGOUTS — moved below calendar/activity for both mobile and desktop ─── */}

      {/* ─── PENDING HANGOUTS (needs action) ─── */}
      {pendingHangouts.length > 0 && (
        <div className="mb-4 sm:mb-6 rounded-2xl border border-amber-200/60 bg-gradient-to-r from-amber-50/50 to-orange-50/30 p-3 sm:p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">⏳</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Pending</h2>
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{pendingHangouts.length}</span>
          </div>
          <div className="space-y-2">
            {pendingHangouts.slice(0, 6).map((m) => {
              const others = otherParticipants(m);
              const isExpanded = expandedMeetupId === m.id;
              const friendId = others.length === 1 ? others[0].userId : null;
              const iNeedToRespond = m.myRsvp === 'pending';
              const waitingOn = m.participants.filter((p) => p.rsvp === 'pending' && p.userId !== currentUserId);
              return (
                <div key={m.id} className="rounded-xl border border-amber-100 bg-white overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-50/30 transition-colors"
                    onClick={() => setExpandedMeetupId(isExpanded ? null : m.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex -space-x-2 shrink-0">
                        {others.slice(0, 3).map((p) => (
                          p.photoUrl ? (
                            <img key={p.userId} src={p.photoUrl} alt="" className="h-8 w-8 rounded-full ring-2 ring-white" loading="lazy" />
                          ) : (
                            <div key={p.userId} className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-semibold text-white ring-2 ring-white">
                              {p.displayName?.[0] ?? '?'}
                            </div>
                          )
                        ))}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {others.map((p) => p.displayName).join(', ')} · {formatMeetupTime(m.start_time)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {iNeedToRespond ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800">
                          📩 Respond
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                          ⏳ Waiting on {waitingOn.map((p) => p.displayName.split(' ')[0]).join(', ') || 'others'}
                        </span>
                      )}
                      <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-amber-100 px-4 py-3 bg-white space-y-3">
                      {/* Participant RSVP status */}
                      <div className="space-y-1">
                        {m.participants.map((p) => (
                          <div key={p.userId} className="flex items-center gap-2 text-[11px]">
                            <span>{p.rsvp === 'accepted' ? '✅' : p.rsvp === 'declined' ? '❌' : '⏳'}</span>
                            <span className="text-gray-600">{p.displayName}</span>
                            <span className="text-gray-400">
                              {p.rsvp === 'accepted' ? 'accepted' : p.rsvp === 'declined' ? 'declined' : 'waiting'}
                            </span>
                          </div>
                        ))}
                      </div>
                      {/* Action buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {iNeedToRespond && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAcceptMeetup(m.id); }}
                              disabled={acceptingMeetupId === m.id}
                              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm disabled:opacity-50"
                            >
                              {acceptingMeetupId === m.id ? 'Accepting…' : '✅ Accept'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelMeetup(m.id); }}
                              disabled={cancellingMeetupId === m.id}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                            >
                              {cancellingMeetupId === m.id ? 'Declining…' : '✕ Decline'}
                            </button>
                          </>
                        )}
                        {!iNeedToRespond && friendId && (
                          <Link
                            to={`/friends?findTimes=${friendId}`}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-slotted-300 transition-all"
                          >
                            🔄 Find new time
                          </Link>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleShareMeetup(m.id, m.title); }}
                          disabled={sharingMeetupId === m.id}
                          className="rounded-lg border border-blue-200 px-3 py-1.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
                        >
                          {sharingMeetupId === m.id && shareUrl ? '✅ Copied!' : sharingMeetupId === m.id ? 'Sharing…' : '🔗 Share'}
                        </button>
                        {!iNeedToRespond && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelMeetup(m.id); }}
                            disabled={cancellingMeetupId === m.id}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                          >
                            {cancellingMeetupId === m.id ? 'Cancelling…' : '✕ Cancel'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── CONFIRMED HANGOUTS ─── */}
      {confirmedHangouts.length > 0 && (
        <div className="mb-4 sm:mb-6 rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/30 to-green-50/20 p-3 sm:p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">✅</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Confirmed</h2>
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{confirmedHangouts.length}</span>
          </div>
          <div className="space-y-2">
            {confirmedHangouts.slice(0, 4).map((m) => {
              const others = otherParticipants(m);
              const isExpanded = expandedMeetupId === m.id;
              const friendId = others.length === 1 ? others[0].userId : null;
              return (
                <div key={m.id} className="rounded-xl border border-emerald-100 bg-white overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-emerald-50/30 transition-colors"
                    onClick={() => setExpandedMeetupId(isExpanded ? null : m.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex -space-x-2 shrink-0">
                        {others.slice(0, 3).map((p) => (
                          p.photoUrl ? (
                            <img key={p.userId} src={p.photoUrl} alt="" className="h-8 w-8 rounded-full ring-2 ring-white" loading="lazy" />
                          ) : (
                            <div key={p.userId} className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-white">
                              {p.displayName?.[0] ?? '?'}
                            </div>
                          )
                        ))}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {others.map((p) => p.displayName).join(', ')} · {formatMeetupTime(m.start_time)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                        ✅ Confirmed
                      </span>
                      <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-emerald-100 px-4 py-3 flex flex-wrap items-center gap-2 bg-white">
                      <button
                        onClick={(e) => { e.stopPropagation(); setCalendarModal({ meetupId: m.id, title: m.title, startTime: m.start_time, endTime: m.end_time }); }}
                        className="rounded-lg bg-slotted-500 px-3 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-slotted-600 shadow-sm"
                      >
                        📅 Add to Calendar
                      </button>
                      {friendId && (
                        <Link
                          to={`/friends?findTimes=${friendId}`}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:border-slotted-300 transition-all"
                        >
                          🔄 Find new time
                        </Link>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShareMeetup(m.id, m.title); }}
                        disabled={sharingMeetupId === m.id}
                        className="rounded-lg border border-blue-200 px-3 py-1.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
                      >
                        {sharingMeetupId === m.id && shareUrl ? '✅ Copied!' : sharingMeetupId === m.id ? 'Sharing…' : '🔗 Share'}
                      </button>
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

      {/* ─── Add to Calendar Modal ─── */}
      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => setCalendarModal(null)}
        />
      )}

      {/* ─── UPCOMING HANGOUTS (mobile only — replaces calendar grid) ─── */}
      {isMobile && (
        <div className="mb-4 rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <span className="text-base">📅</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Upcoming Hangouts</h2>
          </div>
          {upcoming.length === 0 ? (
            <div className="py-8 text-center px-4">
              <span className="text-2xl">📅</span>
              <h3 className="mt-2 font-display text-sm font-bold text-gray-900">No hangouts coming up</h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed max-w-xs mx-auto">
                Find a time that works for everyone and book something fun.
              </p>
              <Link
                to="/friends"
                className="mt-3 inline-flex items-center gap-2 rounded-xl gradient-btn px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                👋 Find a time with a friend
              </Link>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {[
                { label: 'This Week', items: upcomingByWeek.thisWeek },
                { label: 'Next Week', items: upcomingByWeek.nextWeek },
              ].map(({ label, items }) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-500 mb-2">📅 {label}</p>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 italic pl-1">(nothing yet)</p>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((m) => {
                        const d = new Date(m.start_time);
                        const dayAbbrev = d.toLocaleDateString('en-US', { weekday: 'short' });
                        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
                        const isConfirmed = m.status === 'confirmed' || m.participants.every((p) => p.rsvp === 'accepted');
                        const others = otherParticipants(m);
                        const displayTitle = m.title || others.map((p) => p.displayName.split(' ')[0]).join(', ');
                        return (
                          <div key={m.id} className="flex items-center gap-3 rounded-xl bg-gray-50/80 px-3 py-2.5">
                            <div className="shrink-0 text-right" style={{ minWidth: '4.5rem' }}>
                              <span className="text-xs font-semibold text-gray-700">{dayAbbrev}</span>
                              <span className="text-xs text-gray-400 ml-1">{time}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{displayTitle}</p>
                            </div>
                            <span className={`shrink-0 text-xs font-medium ${isConfirmed ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {isConfirmed ? 'confirmed ✓' : 'pending'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── PEOPLE TO SEE (compact avatar row) ─── */}
      {!dashboardLoading && friendsToSee.length === 0 && allFriends.length === 0 && (
        <div className="mb-4 sm:mb-6 rounded-2xl border border-slotted-200/60 bg-gradient-to-br from-slotted-50/60 to-purple-50/40 p-4 sm:p-6 shadow-sm text-center">
          <span className="text-2xl sm:text-3xl">👋</span>
          <h3 className="mt-2 sm:mt-3 font-display text-sm sm:text-base font-bold text-gray-900">Welcome to Slotted.ai!</h3>
          <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
            Invite a friend to get started — Slotted.ai will find the best times to hang out.
          </p>
          <Link
            to="/friends"
            className="mt-3 sm:mt-4 inline-flex items-center gap-2 rounded-xl gradient-btn px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            👋 Invite a friend
          </Link>
        </div>
      )}
      {!dashboardLoading && friendsToSee.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">👋</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Catch up with</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {friendsToSee.slice(0, 12).map((f) => (
              <Link
                key={f.id}
                to={`/friends?findTimes=${f.id}`}
                className="flex-shrink-0 flex flex-col items-center gap-1 w-16 group"
                title={`${f.displayName} — ${f.lastHangout ? timeAgo(f.lastHangout) : "Haven't hung out"}`}
              >
                {f.photoUrl ? (
                  <img src={f.photoUrl} alt="" className="h-11 w-11 rounded-full ring-2 ring-white shadow-sm group-hover:ring-slotted-300 transition-all" loading="lazy" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white shadow-sm ring-2 ring-white group-hover:ring-slotted-300 transition-all">
                    {f.displayName?.[0] ?? '?'}
                  </div>
                )}
                <p className="w-full text-center text-xs font-medium leading-tight text-gray-600 group-hover:text-slotted-600 transition-colors">{f.displayName?.split(' ')[0]}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ─── ACTIVITY FEED ─── */}
      {/* ─── SMART EVENT PICKS ─── */}
      {eventSuggestions.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-sm">🎯</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Events to do with friends</h2>
            </div>
            <Link to="/events" className="text-[11px] font-semibold text-slotted-600 hover:text-slotted-700 transition-colors">
              Browse all →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {eventSuggestions.slice(0, 3).map((ev) => (
              <Link key={ev.id} to={`/events`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slotted-50/30">
                {ev.imageUrl ? (
                  <img src={ev.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0 shadow-sm" loading="lazy" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 text-lg">
                    🎟️
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {ev.datetimeLocal ? new Date(ev.datetimeLocal).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                    {ev.venue ? ` · ${ev.venue}` : ''}
                  </p>
                  <p className="text-[11px] text-slotted-600 font-medium mt-0.5 truncate">{ev.reason}</p>
                </div>
                <div className="flex -space-x-1.5 shrink-0">
                  {(ev.matchingFriends || []).slice(0, 3).map((f) => (
                    f.photo ? (
                      <img key={f.id} src={f.photo} alt="" className="h-6 w-6 rounded-full ring-2 ring-white" title={f.name} loading="lazy" />
                    ) : (
                      <div key={f.id} className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[8px] font-bold text-white ring-2 ring-white" title={f.name}>
                        {f.name?.[0]}
                      </div>
                    )
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ─── SAVED EVENTS ─── */}
      {savedEvents.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-sm">❤️</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Saved Events</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{savedEvents.length}</span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {savedEvents.map((ev) => (
              <a
                key={ev.id}
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50/50"
              >
                {ev.image_url ? (
                  <img src={ev.image_url} alt="" className="h-11 w-11 rounded-xl object-cover shrink-0 shadow-sm" loading="lazy" />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 text-lg">
                    🎟️
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {ev.datetime_local ? new Date(ev.datetime_local.replace(' ', 'T')).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ev.datetime_utc ? new Date(ev.datetime_utc).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                    {ev.venue ? ` · ${ev.venue}` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-slotted-600 hover:border-slotted-200 transition-colors">
                  🎟️ Tickets
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {activities.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm">✨</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">Activity</h2>
          </div>
          <div className="space-y-2">
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
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors relative group"
                >
                  {activity.friendPhoto ? (
                    <img
                      src={activity.friendPhoto}
                      alt={activity.friendName}
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-base">{activityIcon}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-gray-900">{activity.message}</p>
                    {activity.timestamp && (
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {timeAgo(activity.timestamp)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      setDismissingActivity(activityKey);
                      const previousActivities = queryClient.getQueryData<ActivityFeedItem[]>(queryKeys.activityFeed) ?? activities;
                      queryClient.setQueryData(
                        queryKeys.activityFeed,
                        previousActivities.filter((_, i) => i !== index),
                      );
                      try {
                        await dismissActivityMutation.mutateAsync({ activityType: activity.type, friendId: activity.friendId });
                      } catch {
                        queryClient.setQueryData(queryKeys.activityFeed, previousActivities);
                      } finally {
                        setDismissingActivity(null);
                      }
                    }}
                    disabled={dismissingActivity === activityKey}
                    className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 p-2"
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

      {!dashboardLoading && allFriends.length > 0 && upcoming.length === 0 && (
        <div className="mb-6 rounded-2xl border border-dashed border-slotted-200 bg-slotted-50/30 p-4 sm:p-6 text-center">
          <span className="text-2xl sm:text-3xl">📅</span>
          <h3 className="mt-1.5 sm:mt-2 font-display text-sm sm:text-base font-bold text-gray-900">No hangouts coming up</h3>
          <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
            Find a time that works for everyone and book something fun.
          </p>
          <Link
            to="/friends"
            className="mt-3 sm:mt-4 inline-flex items-center gap-2 rounded-xl gradient-btn px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            👋 Find a time with a friend
          </Link>
        </div>
      )}

      {/* ─── HANGOUT HISTORY + LOG (hidden when empty) ─── */}
      {(showLogForm || pastConfirmed.filter((m) => m.status !== 'didnt_happen').length > 0) && (
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
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-base shrink-0">✅</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {others.map((p) => p.displayName).join(', ')} · {formatMeetupTime(m.start_time)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setDidntHappenId(isDidntHappen ? null : m.id)}
                      className="shrink-0 ml-2 text-[11px] font-medium text-gray-400 hover:text-red-500 transition-colors"
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
            {/* Date */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Date</label>
              <input
                type="date"
                value={logDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setLogDate(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all w-full"
              />
            </div>
            {/* Who */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Who did you hang out with?</label>
              {allFriends.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {allFriends.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { setLogFriendId(logFriendId === f.id ? '' : f.id); setLogFriendName(''); }}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        logFriendId === f.id
                          ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {f.photoUrl ? (
                        <img src={f.photoUrl} alt="" className="w-4 h-4 rounded-full object-cover" loading="lazy" />
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-gradient-to-br from-slotted-400 to-purple-400 flex items-center justify-center text-[8px] text-white font-bold">{f.displayName[0]}</span>
                      )}
                      {f.displayName.split(' ')[0]}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={logFriendId ? '' : logFriendName}
                disabled={!!logFriendId}
                onChange={(e) => { setLogFriendName(e.target.value); setLogFriendId(''); }}
                placeholder={logFriendId ? allFriends.find(f => f.id === logFriendId)?.displayName || 'Selected' : 'Or type a name (not on Slotted.ai)...'}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all w-full disabled:opacity-50 disabled:bg-gray-50"
              />
            </div>
            {/* Activity */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Activity</label>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLogActivity(logActivity === opt.value ? '' : opt.value)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-all ${
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
              <div className="flex flex-wrap gap-1.5">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLogDuration(logDuration === opt.value ? null : opt.value)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-all ${
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
                    onClick={() => setLogTimeOfDay(logTimeOfDay === opt.value ? '' : opt.value)}
                    className={`flex-1 rounded-lg border px-1.5 py-1.5 text-[11px] font-medium whitespace-nowrap text-center transition-all ${
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
                    try {
                      const hangoutDate = new Date(logDate + 'T12:00:00');
                      await logMeetupMutation.mutateAsync({
                        activity_type: logActivity || null,
                        duration_min: logDuration || null,
                        day_of_week: hangoutDate.getDay(),
                        time_of_day: logTimeOfDay || null,
                        rating: logRating || null,
                        hangout_date: logDate,
                        friend_id: logFriendId || null,
                        friend_name: (!logFriendId && logFriendName.trim()) ? logFriendName.trim() : null,
                      });
                      setLogSaved(true);
                      setTimeout(() => { setLogSaved(false); setShowLogForm(false); setLogFriendId(''); setLogFriendName(''); setLogDate(new Date().toISOString().slice(0, 10)); setLogActivity(''); setLogDuration(null); setLogTimeOfDay(''); setLogRating(0); }, 2000);
                    } catch (err) {
                      const error = err as { response?: { data?: { error?: string } } };
                      console.error('Hangout log error:', err);
                      alert(error.response?.data?.error || 'Failed to save hangout. Please try again.');
                    }
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
      )}

      {/* Connect calendar CTA (only if no calendar) */}
      {!calendarConnected && (
        <div className="mt-4 sm:mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-4 sm:p-5 text-center">
          <span className="text-xl sm:text-2xl">📅</span>
          <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm font-medium text-gray-700">Connect your calendar for automatic availability</p>
          <Link
            to="/settings"
            className="mt-2.5 sm:mt-3 inline-block rounded-xl gradient-btn px-4 sm:px-5 py-1.5 sm:py-2 text-xs font-semibold text-white shadow-sm"
          >
            Connect Google Calendar →
          </Link>
        </div>
      )}
    </AppShell>
  );
}
