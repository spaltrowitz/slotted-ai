import { useState, useEffect, useMemo, useCallback, startTransition } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import AddToCalendarModal from '../components/AddToCalendarModal';
import EventScheduleButton from '../components/EventScheduleButton';
import StarRating from '../components/StarRating';
import SmartSuggestions from '../components/SmartSuggestions';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';
import { useAuth } from '../contexts/AuthContext';
import { trackFriendAdded } from '../lib/analytics';
import api from '../lib/api';
import { getFirstName, getSmartDisplayName, formatMeetupTime } from '../lib/utils';
import { getUserStage, type UserStage } from '../lib/userStage';
import {
  fetchDashboard,
  fetchFriends,
  fetchMeetups,
  queryKeys,
  type FriendRecord,
} from '../lib/queries';

type SavedFriendGroup = {
  id: string;
  name: string;
  friendIds: string[];
};

type EventPollSummary = {
  id: string;
  eventTitle: string;
  eventVenue?: string | null;
  showtimeCount: number;
  status: string;
  invitesClosed?: boolean;
  invitesClosedAt?: string | null;
  lifecycleStatus?: 'open' | 'confirmed' | 'expired';
  confirmedAt?: string | null;
  confirmedSource?: string | null;
  confirmedMeetupId?: string | null;
  createdAt?: string;
  isOwner: boolean;
  needsMyPicks?: boolean;
  inviteUrl?: string | null;
  voted: { userId: string; name: string; photoUrl?: string | null; selectedCount: number; votedAt: string }[];
  pending: { userId: string; name: string; photoUrl?: string | null }[];
};

/* ─── stage components ─── */

function StageNoCalendar() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h2 className="text-xl font-semibold text-gray-900">
        Connect your calendar to get started
      </h2>
      <p className="mt-3 max-w-xs text-sm text-gray-500 leading-relaxed">
        Slotted finds times when you and your friends are both free.
      </p>
      <Link
        to="/settings"
        className="mt-8 rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
      >
        Connect Google Calendar
      </Link>
    </div>
  );
}

function StageNoFriends({ inviteUrl }: { inviteUrl: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Let's hang! This app finds times we're both free — no more back-and-forth 📅`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join me on Slotted', text: message, url: inviteUrl });
      } catch {
        // user cancelled share
      }
    } else {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h2 className="text-xl font-semibold text-gray-900">
        You're set up! Now invite a friend.
      </h2>
      <p className="mt-3 max-w-xs text-sm text-gray-500 leading-relaxed">
        Slotted finds times that work for both of you.
      </p>
      <button
        onClick={handleShare}
        className="mt-8 rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
      >
        {copied ? 'Copied!' : 'Share invite link'}
      </button>
    </div>
  );
}

function StagePendingInvite({
  invites,
  allFriendNames,
  onAccept,
  onDecline,
  accepting,
}: {
  invites: FriendRecord[];
  allFriendNames: string[];
  onAccept: (friendshipId: string) => void;
  onDecline: (friendshipId: string) => void;
  accepting: boolean;
}) {
  const primary = invites[0];
  const othersCount = invites.length - 1;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      {primary.friend.photoUrl ? (
        <img
          src={primary.friend.photoUrl}
          alt=""
          className="h-16 w-16 rounded-full ring-2 ring-white shadow-md"
          loading="lazy"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xl font-semibold text-white shadow-md ring-2 ring-white">
          {primary.friend.displayName?.[0] ?? '?'}
        </div>
      )}
      <h2 className="mt-5 text-xl font-semibold text-gray-900">
        {getSmartDisplayName(primary.friend.displayName, allFriendNames)} wants to connect!
      </h2>
      {othersCount > 0 && (
        <p className="mt-1 text-sm text-gray-500">
          and {othersCount} other{othersCount > 1 ? 's' : ''}
        </p>
      )}
      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => onAccept(primary.friendshipId)}
          disabled={accepting}
          className="rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          onClick={() => onDecline(primary.friendshipId)}
          className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function ShareInviteButton({ inviteUrl, variant }: { inviteUrl: string; variant: 'secondary' | 'inline' }) {
  const [copied, setCopied] = useState(false);
  const message = `Let's hang! This app finds times we're both free — no more back-and-forth 📅`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join me on Slotted', text: message, url: inviteUrl });
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (variant === 'inline') {
    return (
      <button
        onClick={handleShare}
        className="shrink-0 rounded-full border border-slotted-200 bg-slotted-50 px-3 py-1.5 text-xs font-semibold text-slotted-700 transition-all hover:border-slotted-300 hover:bg-slotted-100"
      >
        {copied ? 'Copied!' : 'Invite a friend'}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-center text-sm font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:border-slotted-300"
    >
      {copied ? 'Copied!' : 'Invite a friend'}
    </button>
  );
}

function PersonChip({
  person,
  tone,
}: {
  person: { userId: string; name: string; photoUrl?: string | null };
  tone: 'confirmed' | 'pending';
}) {
  const toneClasses = tone === 'confirmed'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
    : 'border-slate-100 bg-slate-50 text-slate-700';

  return (
    <span className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-full border py-1 pl-1 pr-2 text-[11px] font-semibold ${toneClasses}`}>
      {person.photoUrl ? (
        <img src={person.photoUrl} alt="" className="h-5 w-5 rounded-full ring-1 ring-white" loading="lazy" />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[10px] font-semibold text-white ring-1 ring-white">
          {person.name?.[0] ?? '?'}
        </span>
      )}
      {person.name}
    </span>
  );
}

/* ─── loading skeleton ─── */
function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded-lg bg-gray-200/60" />
        <div className="h-4 w-32 rounded-lg bg-gray-100" />
      </div>
      <div className="flex flex-col items-center gap-4 pt-16">
        <div className="h-16 w-16 rounded-full bg-gray-200/60" />
        <div className="h-5 w-56 rounded-lg bg-gray-200/60" />
        <div className="h-4 w-40 rounded-lg bg-gray-100" />
        <div className="mt-4 h-12 w-48 rounded-xl bg-gray-200/60" />
      </div>
    </div>
  );
}

/* ─── main component ─── */
export default function DashboardPage() {
  const { user, calendarConnected, calendarJustConnected } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  // Friend selection state (merged from FriendsPage)
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string>('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupFriendIds, setGroupFriendIds] = useState<string[] | null>(null);
  const [savedGroups, setSavedGroups] = useState<SavedFriendGroup[]>([]);
  const [showAllFriends, setShowAllFriends] = useState(false);
  const [copiedPollId, setCopiedPollId] = useState<string | null>(null);
  const [sharingPollId, setSharingPollId] = useState<string | null>(null);
  const [pollFriendSelections, setPollFriendSelections] = useState<Record<string, string>>({});
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);
  const [eventPollsMinimized, setEventPollsMinimized] = useState(false);
  const [friendTipDismissed, setFriendTipDismissed] = useState(false);

  const userUid = user?.uid;
  const inviteUrl = `https://slotted-ai.web.app?ref=${userUid ?? ''}`;
  const savedGroupsKey = userUid ? `slotted_saved_friend_groups_${userUid}` : null;
  const eventPollsMinimizedKey = userUid ? `slotted_event_polls_minimized_${userUid}` : null;
  const friendTipDismissedKey = userUid ? `slotted_friend_tip_dismissed_${userUid}` : null;

  /* ─── data fetching ─── */
  const { isLoading: dashboardLoading } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: fetchDashboard,
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

  const { data: eventPolls = [] } = useQuery({
    queryKey: ['event-polls'],
    queryFn: async () => {
      const { data } = await api.get<{ schedules: EventPollSummary[] }>('/events/schedules');
      return data.schedules;
    },
    enabled: !!userUid,
  });

  /* ─── friend action mutations ─── */
  const friendActionMutation = useMutation({
    mutationFn: async ({ friendshipId, action }: { friendshipId: string; action: 'accept' | 'decline' }) => {
      await api.patch(`/friends/${friendshipId}`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });

  const nudgePollMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      await api.post(`/events/schedules/${scheduleId}/nudge`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-polls'] });
    },
  });

  const deletePollMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      await api.delete(`/events/schedules/${scheduleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-polls'] });
    },
  });

  const addPollFriendMutation = useMutation({
    mutationFn: async ({ scheduleId, friendId }: { scheduleId: string; friendId: string }) => {
      await api.post(`/events/schedules/${scheduleId}/participants`, { friendIds: [friendId] });
    },
    onSuccess: (_, { scheduleId }) => {
      setPollFriendSelections((prev) => ({ ...prev, [scheduleId]: '' }));
      queryClient.invalidateQueries({ queryKey: ['event-polls'] });
    },
  });

  const closePollInvitesMutation = useMutation({
    mutationFn: async ({ scheduleId, closed }: { scheduleId: string; closed: boolean }) => {
      await api.post(`/events/schedules/${scheduleId}/invites-closed`, { closed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-polls'] });
    },
  });

  const getPollInviteUrl = useCallback(async (poll: EventPollSummary) => {
    if (poll.inviteUrl) return poll.inviteUrl;
    const { data } = await api.post<{ inviteUrl: string }>(`/events/schedules/${poll.id}/invite-link`);
    queryClient.invalidateQueries({ queryKey: ['event-polls'] });
    return data.inviteUrl;
  }, [queryClient]);

  const copyPollInvite = useCallback(async (poll: EventPollSummary) => {
    setSharingPollId(poll.id);
    try {
      const inviteUrl = await getPollInviteUrl(poll);
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedPollId(poll.id);
      setTimeout(() => setCopiedPollId(null), 2000);
    } finally {
      setSharingPollId(null);
    }
  }, [getPollInviteUrl]);

  const textPollInvite = useCallback(async (poll: EventPollSummary) => {
    setSharingPollId(poll.id);
    try {
      const inviteUrl = await getPollInviteUrl(poll);
      const message = `Pick your dates for ${poll.eventTitle}${poll.eventVenue ? ` at ${poll.eventVenue}` : ''} with me`;
      window.open(`sms:?&body=${encodeURIComponent(`${message}\n\n${inviteUrl}`)}`, '_self');
    } finally {
      setSharingPollId(null);
    }
  }, [getPollInviteUrl]);

  /* ─── derived data ─── */
  const currentUserId = user?.uid?.replace(/^firebase_/, '') || '';
  const now = useMemo(() => new Date(), []);

  const acceptedFriends = useMemo(
    () => {
      const accepted = friendsData.filter((f) => f.status === 'accepted');
      // Sort by people you make the most plans with: total hangouts desc,
      // then most recent, then alphabetical. This makes the first 8 faces
      // (when collapsed) your closest, most-frequent friends.
      return accepted.sort((a, b) => {
        const aHangouts = a.totalHangouts ?? 0;
        const bHangouts = b.totalHangouts ?? 0;
        if (aHangouts !== bHangouts) return bHangouts - aHangouts;
        const aDays = a.daysSinceLastHangout ?? 9999;
        const bDays = b.daysSinceLastHangout ?? 9999;
        if (aDays !== bDays) return aDays - bDays;
        return getFirstName(a.friend.displayName).localeCompare(getFirstName(b.friend.displayName));
      });
    },
    [friendsData],
  );

  const allFriendNames = useMemo(
    () => friendsData.map((f) => f.friend.displayName),
    [friendsData],
  );

  const sortedEventPolls = useMemo(
    () => [...eventPolls].sort((a, b) => {
      const aNeedsMe = a.needsMyPicks ? 1 : 0;
      const bNeedsMe = b.needsMyPicks ? 1 : 0;
      if (aNeedsMe !== bNeedsMe) return bNeedsMe - aNeedsMe;
      const aReady = a.isOwner && Boolean(a.invitesClosed) && !a.needsMyPicks && a.pending.length === 0 && a.voted.length > 0 ? 1 : 0;
      const bReady = b.isOwner && Boolean(b.invitesClosed) && !b.needsMyPicks && b.pending.length === 0 && b.voted.length > 0 ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      if (a.isOwner !== b.isOwner) return Number(b.isOwner) - Number(a.isOwner);
      if (a.pending.length !== b.pending.length) return b.pending.length - a.pending.length;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }),
    [eventPolls],
  );

  const pendingInbound = useMemo(
    () => friendsData.filter((f) => f.status === 'pending' && f.invitedBy === f.friend.id),
    [friendsData],
  );

  const outgoingInvites = useMemo(
    () => friendsData.filter((f) => f.status === 'pending' && f.invitedBy !== f.friend.id),
    [friendsData],
  );

  const upcoming = useMemo(
    () =>
      meetups.filter((m) => {
        const start = new Date(m.start_time);
        return start >= now && !['cancelled', 'didnt_happen', 'declined'].includes(m.status) && m.myRsvp !== 'declined';
      }),
    [meetups, now],
  );

  const completedHangouts = useMemo(
    () =>
      meetups.filter((m) => {
        const end = new Date(m.end_time);
        return end < now && (m.status === 'confirmed' || (m.status === 'proposed' && m.myRsvp === 'accepted'));
      }),
    [meetups, now],
  );

  const completedHangoutCount = completedHangouts.length;

  const validSavedGroups = useMemo(
    () => savedGroups
      .map((group) => ({
        ...group,
        friendIds: group.friendIds.filter((id) => acceptedFriends.some((f) => f.friend.id === id)),
      }))
      .filter((group) => group.friendIds.length >= 2),
    [savedGroups, acceptedFriends],
  );

  const visibleFriends = useMemo(
    () => acceptedFriends.length > 8 && !showAllFriends ? acceptedFriends.slice(0, 8) : acceptedFriends,
    [acceptedFriends, showAllFriends],
  );

  const selectedGroupExists = useMemo(() => {
    if (selectedIds.size < 2) return false;
    const selected = [...selectedIds].sort().join('|');
    return validSavedGroups.some((group) => [...group.friendIds].sort().join('|') === selected);
  }, [selectedIds, validSavedGroups]);

  const stage: UserStage = useMemo(
    () =>
      getUserStage({
        calendarConnected,
        friendCount: acceptedFriends.length,
        pendingInvitesCount: pendingInbound.length,
        completedHangoutCount,
        upcomingHangoutCount: upcoming.length,
      }),
    [calendarConnected, acceptedFriends.length, pendingInbound.length, completedHangoutCount, upcoming.length],
  );

  const isLoading = dashboardLoading;

  useEffect(() => {
    if (!savedGroupsKey) {
      setSavedGroups([]);
      return;
    }
    try {
      const raw = localStorage.getItem(savedGroupsKey);
      setSavedGroups(raw ? JSON.parse(raw) as SavedFriendGroup[] : []);
    } catch {
      setSavedGroups([]);
    }
  }, [savedGroupsKey]);

  useEffect(() => {
    if (!savedGroupsKey) return;
    try {
      localStorage.setItem(savedGroupsKey, JSON.stringify(savedGroups));
    } catch {
      // ignore local storage quota/private mode failures
    }
  }, [savedGroups, savedGroupsKey]);

  useEffect(() => {
    if (!eventPollsMinimizedKey) {
      setEventPollsMinimized(false);
      return;
    }
    try {
      setEventPollsMinimized(localStorage.getItem(eventPollsMinimizedKey) === 'true');
    } catch {
      setEventPollsMinimized(false);
    }
  }, [eventPollsMinimizedKey]);

  useEffect(() => {
    if (!eventPollsMinimizedKey) return;
    try {
      localStorage.setItem(eventPollsMinimizedKey, String(eventPollsMinimized));
    } catch {
      // ignore local storage quota/private mode failures
    }
  }, [eventPollsMinimized, eventPollsMinimizedKey]);

  useEffect(() => {
    if (!friendTipDismissedKey) {
      setFriendTipDismissed(false);
      return;
    }
    try {
      setFriendTipDismissed(localStorage.getItem(friendTipDismissedKey) === 'true');
    } catch {
      setFriendTipDismissed(false);
    }
  }, [friendTipDismissedKey]);

  const dismissFriendTip = useCallback(() => {
    setFriendTipDismissed(true);
    if (!friendTipDismissedKey) return;
    try {
      localStorage.setItem(friendTipDismissedKey, 'true');
    } catch {
      // ignore local storage quota/private mode failures
    }
  }, [friendTipDismissedKey]);

  /* ─── friend selection handlers (from FriendsPage) ─── */
  useEffect(() => {
    const findTimesId = searchParams.get('findTimes');
    if (findTimesId && friendsData.length > 0) {
      const friend = friendsData.find(f => f.friend.id === findTimesId && f.status === 'accepted');
      if (friend) {
        setSelectedFriendId(findTimesId);
        setSelectedFriendName(friend.friend.displayName);
      }
    }
  }, [searchParams, friendsData]);

  const handleFindTimes = useCallback((friendId: string, friendName: string) => {
    setSelectedFriendId(friendId);
    setSelectedFriendName(friendName);
    setGroupFriendIds(null);
    setSelectedIds(new Set([friendId]));
    if (!selectMode) setSelectMode(true);
  }, [selectMode]);

  const handleCloseFindTimes = useCallback(() => {
    setSelectedFriendId(null);
    setSelectedFriendName('');
    setSelectedIds(new Set());
    setSelectMode(false);
    startTransition(() => {
      setSearchParams({}, { replace: true });
    });
  }, [setSearchParams]);

  const toggleSelect = useCallback((friendId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const isRemoving = next.has(friendId);
      if (isRemoving) {
        next.delete(friendId);
        if (selectedFriendId === friendId) {
          setSelectedFriendId(null);
          setSelectedFriendName('');
          startTransition(() => {
            setSearchParams({}, { replace: true });
          });
        }
        if (groupFriendIds?.includes(friendId)) {
          setGroupFriendIds(null);
        }
      } else {
        next.add(friendId);
      }
      return next;
    });
  }, [groupFriendIds, selectedFriendId, setSearchParams]);

  const handleRowClick = useCallback((f: FriendRecord) => {
    if (selectMode) {
      toggleSelect(f.friend.id);
    } else {
      handleFindTimes(f.friend.id, f.friend.displayName);
    }
  }, [selectMode, toggleSelect, handleFindTimes]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const openSavedGroup = useCallback((friendIds: string[]) => {
    setGroupFriendIds(friendIds);
    setSelectedIds(new Set(friendIds));
    setSelectedFriendId(null);
    setSelectedFriendName('');
    setSelectMode(false);
    startTransition(() => {
      setSearchParams({}, { replace: true });
    });
  }, [setSearchParams]);

  const saveSelectedGroup = useCallback(() => {
    if (selectedIds.size < 2 || selectedGroupExists) return;
    const friendIds = [...selectedIds];
    const names = friendIds
      .map((id) => acceptedFriends.find((f) => f.friend.id === id)?.friend.displayName)
      .filter((name): name is string => Boolean(name))
      .map((name) => getFirstName(name));
    const name = names.join(' + ');

    setSavedGroups((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${friendIds.sort().join('-')}`,
        name,
        friendIds,
      },
    ]);
  }, [acceptedFriends, selectedGroupExists, selectedIds]);

  const deleteSavedGroup = useCallback((groupId: string) => {
    setSavedGroups((prev) => prev.filter((group) => group.id !== groupId));
  }, []);

  useEffect(() => {
    if (selectedIds.size === 0 && selectMode) {
      setSelectMode(false);
    }
  }, [selectedIds, selectMode]);

  const handleFriendAction = async (friendshipId: string, action: 'accept' | 'decline') => {
    if (!user) return;
    try {
      await friendActionMutation.mutateAsync({ friendshipId, action });
      if (action === 'accept') trackFriendAdded();
    } catch (err) {
      console.error('Failed to update friendship:', err);
    }
  };


  const lastSeenLabel = (f: FriendRecord) => {
    const days = f.daysSinceLastHangout;
    if (days === undefined || days === null || !f.lastHangoutDate) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  /* ─── hangout rating prompt ─── */
  const RATED_KEY = 'slotted_rated_meetups';
  const getRatedIds = useCallback((): Set<string> => {
    try {
      const raw = localStorage.getItem(RATED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }, []);

  const [ratedIds, setRatedIds] = useState<Set<string>>(() => getRatedIds());

  const meetupToRate = useMemo(() => {
    if (completedHangouts.length === 0) return null;
    const sorted = [...completedHangouts].sort(
      (a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime(),
    );
    return sorted.find((m) => !ratedIds.has(m.id)) ?? null;
  }, [completedHangouts, ratedIds]);

  const ratingFriendName = useMemo(() => {
    if (!meetupToRate) return '';
    const others = meetupToRate.participants.filter((p) => p.userId !== currentUserId);
    return getSmartDisplayName(others[0]?.displayName, allFriendNames) || 'your friend';
  }, [meetupToRate, currentUserId, allFriendNames]);

  const rateMutation = useMutation({
    mutationFn: async ({ meetupId, rating }: { meetupId: string; rating: number }) => {
      const meetup = meetups.find((m) => m.id === meetupId);
      const others = meetup?.participants.filter((p) => p.userId !== currentUserId) ?? [];
      await api.post('/meetup-logs', {
        friend_name: others[0]?.displayName || '',
        hangout_date: meetup?.start_time ? new Date(meetup.start_time).toISOString().slice(0, 10) : undefined,
        rating,
      });
    },
    onSuccess: (_data, { meetupId }) => {
      const updated = new Set(ratedIds);
      updated.add(meetupId);
      setRatedIds(updated);
      try {
        localStorage.setItem(RATED_KEY, JSON.stringify([...updated]));
      } catch { /* ignore */ }
    },
  });

  const dismissRating = useCallback((meetupId: string) => {
    const updated = new Set(ratedIds);
    updated.add(meetupId);
    setRatedIds(updated);
    try {
      localStorage.setItem(RATED_KEY, JSON.stringify([...updated]));
    } catch { /* ignore */ }
  }, [ratedIds]);

  /* ─── active user stage: unified layout ─── */
  const isActiveStage = stage === 'active-user' || stage === 'has-hangouts' || stage === 'first-hangout';

  /* ─── render ─── */
  return (
    <AppShell>
      {/* Calendar just connected toast */}
      {calendarJustConnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-in fade-in">
          <span className="text-lg">✅</span>
          <p className="text-sm font-medium text-emerald-700">Calendar connected!</p>
        </div>
      )}

      {isLoading && <DashboardSkeleton />}

      {/* Hangout rating prompt */}
      {!isLoading && meetupToRate && (
        <div className="mb-5 rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
          <StarRating
            friendName={ratingFriendName}
            onSubmit={(rating) => rateMutation.mutate({ meetupId: meetupToRate.id, rating })}
            onSkip={() => dismissRating(meetupToRate.id)}
            submitting={rateMutation.isPending}
          />
        </div>
      )}

      {!isLoading && stage === 'no-calendar' && <StageNoCalendar />}

      {!isLoading && stage === 'no-friends' && <StageNoFriends inviteUrl={inviteUrl} />}

      {!isLoading && stage === 'pending-invite' && (
        <StagePendingInvite
          invites={pendingInbound}
          allFriendNames={allFriendNames}
          onAccept={(id) => friendActionMutation.mutate({ friendshipId: id, action: 'accept' })}
          onDecline={(id) => friendActionMutation.mutate({ friendshipId: id, action: 'decline' })}
          accepting={friendActionMutation.isPending}
        />
      )}

      {/* ─── Unified active stage (first-hangout / has-hangouts / active-user) ─── */}
      {!isLoading && isActiveStage && (
        <div className="space-y-6">
          {/* 1. Smart AI Suggestions */}
          <SmartSuggestions />

          {eventPolls.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">Events in the works</h2>
                <div className="flex shrink-0 items-center gap-2">
                  {eventPolls.length > 3 && !eventPollsMinimized && (
                    <span className="text-[11px] font-medium text-gray-400">Top 3 of {eventPolls.length}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEventPollsMinimized((prev) => !prev);
                      setExpandedPollId(null);
                    }}
                    className="min-h-[32px] rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-500 transition-colors hover:bg-gray-50"
                    aria-expanded={!eventPollsMinimized}
                  >
                    {eventPollsMinimized ? 'Expand' : 'Minimize'}
                  </button>
                </div>
              </div>
              {eventPollsMinimized ? (
                <button
                  type="button"
                  onClick={() => setEventPollsMinimized(false)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-3 py-2 text-left shadow-sm"
                >
                  <span className="min-w-0 truncate text-xs font-medium text-gray-600">
                    {eventPolls.length} active event poll{eventPolls.length === 1 ? '' : 's'}
                  </span>
                  <span className="text-[11px] font-semibold text-violet-600">
                    Show
                  </span>
                </button>
              ) : (
              <div className="space-y-2">
                {sortedEventPolls.slice(0, 3).map((poll) => {
                  // (pending names rendered as chips below; no inline list needed)
                  const knownParticipantCount = poll.voted.length + poll.pending.length;
                  const knownResponsePct = knownParticipantCount ? Math.round((poll.voted.length / knownParticipantCount) * 100) : 0;
                  const needsMyPicks = Boolean(poll.needsMyPicks);
                  const hasAllKnownResponses = !needsMyPicks && poll.pending.length === 0 && poll.voted.length > 0;
                  const isReadyToChoose = poll.isOwner && Boolean(poll.invitesClosed) && hasAllKnownResponses;
                  const pickedLabel = needsMyPicks
                    ? 'Draft'
                    : isReadyToChoose
                      ? 'Ready to choose'
                      : hasAllKnownResponses && poll.isOwner
                        ? 'Invites open'
                      : poll.voted.length === 0
                      ? 'Waiting for responses'
                      : `${poll.voted.length} ${poll.voted.length === 1 ? 'response' : 'responses'}`;
                  const pollParticipantIds = new Set([
                    ...poll.voted.map((v) => v.userId),
                    ...poll.pending.map((p) => p.userId),
                  ]);
                  const friendsAvailableForPoll = acceptedFriends.filter((friend) => !pollParticipantIds.has(friend.friend.id));
                  const selectedPollFriendId = pollFriendSelections[poll.id] || '';
                  const isExpanded = expandedPollId === poll.id;
                  return (
                    <div
                      key={poll.id}
                      className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{poll.eventTitle}</p>
                          {poll.eventVenue && (
                            <p className="truncate text-xs text-gray-500">{poll.eventVenue}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className={`font-medium ${isReadyToChoose ? 'text-emerald-700' : 'text-gray-600'}`}>
                            {pickedLabel}
                          </span>
                          <span className="text-gray-500">
                            {poll.showtimeCount} showtime{poll.showtimeCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                            style={{ width: `${knownResponsePct}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs">
                        {isReadyToChoose && (
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                            <p className="font-semibold text-emerald-800">Everyone filled it out 🎉 Review the overlap and pick the date.</p>
                          </div>
                        )}
                        {poll.isOwner && !poll.invitesClosed && (
                          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-amber-800">Done inviting?</p>
                                <p className="mt-0.5 text-amber-700">
                                  Mark invites complete after everyone has the link.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => closePollInvitesMutation.mutate({ scheduleId: poll.id, closed: true })}
                                disabled={closePollInvitesMutation.isPending}
                                className="min-h-[44px] shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
                              >
                                {closePollInvitesMutation.isPending ? 'Closing…' : 'Mark complete'}
                              </button>
                            </div>
                          </div>
                        )}
                        {poll.invitesClosed && !isReadyToChoose && (
                          <p className="px-1 text-[11px] font-medium text-violet-700">
                            🔒 Invites closed — link only works for people already in this poll.
                          </p>
                        )}
                        {poll.voted.length > 0 && (
                          <div className="rounded-xl border border-emerald-100 bg-white px-2.5 py-2">
                            <p className="mb-1.5 text-[11px] font-semibold text-emerald-700">✅ Confirmed availability</p>
                            <div className="flex flex-wrap gap-1.5">
                              {poll.voted.map((person) => (
                                <PersonChip key={person.userId} person={person} tone="confirmed" />
                              ))}
                            </div>
                          </div>
                        )}
                        {poll.pending.length > 0 && !needsMyPicks && (
                          <div className="rounded-xl border border-slate-100 bg-white px-2.5 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {poll.isOwner && (
                                <button
                                  type="button"
                                  onClick={() => nudgePollMutation.mutate(poll.id)}
                                  disabled={nudgePollMutation.isPending}
                                  className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
                                >
                                  {nudgePollMutation.isPending ? 'Sending…' : '👋 Nudge'}
                                </button>
                              )}
                              {poll.pending.map((person) => (
                                <PersonChip key={person.userId} person={person} tone="pending" />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className={`mt-3 grid gap-2 ${poll.invitesClosed ? 'grid-cols-2' : 'grid-cols-3'}`}>
                        <Link
                          to={`/event-poll/${poll.id}`}
                          className={`flex min-h-[40px] items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-semibold transition-colors ${
                            needsMyPicks
                              ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm'
                              : isReadyToChoose
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm'
                                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {needsMyPicks ? 'Choose dates' : isReadyToChoose ? 'Pick date' : 'Edit dates'}
                        </Link>
                        {!poll.invitesClosed && (
                          <button
                            type="button"
                            onClick={() => copyPollInvite(poll)}
                            disabled={sharingPollId === poll.id}
                            className={`min-h-[40px] rounded-xl px-2 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
                              needsMyPicks
                                ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm'
                                : isReadyToChoose
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm hover:shadow-md'
                            }`}
                          >
                            {copiedPollId === poll.id ? 'Copied!' : 'Copy link'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedPollId(isExpanded ? null : poll.id)}
                          className="min-h-[40px] rounded-xl border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? 'Less' : 'More'}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50/70 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => textPollInvite(poll)}
                              disabled={sharingPollId === poll.id}
                              className="min-h-[38px] w-auto rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              {sharingPollId === poll.id ? 'Opening...' : 'Text invite link'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const message = poll.isOwner
                                  ? `Are you sure you want to delete the ${poll.eventTitle} poll? This removes it for everyone.`
                                  : `Are you sure you want to remove the ${poll.eventTitle} poll from your dashboard?`;
                                if (window.confirm(message)) {
                                  deletePollMutation.mutate(poll.id);
                                }
                              }}
                              disabled={deletePollMutation.isPending}
                              className="min-h-[38px] w-auto rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                            {poll.isOwner ? 'Delete poll' : 'Leave poll'}
                          </button>
                        </div>
                          {poll.isOwner && poll.invitesClosed && (
                            <button
                              type="button"
                              onClick={() => closePollInvitesMutation.mutate({ scheduleId: poll.id, closed: !poll.invitesClosed })}
                              disabled={closePollInvitesMutation.isPending}
                              className="mt-2 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              Reopen invites
                            </button>
                          )}
                          {poll.isOwner && friendsAvailableForPoll.length > 0 && (
                            <div className="mt-2 flex items-center gap-2">
                                <select
                                  value={selectedPollFriendId}
                                  onChange={(event) => setPollFriendSelections((prev) => ({ ...prev, [poll.id]: event.target.value }))}
                                  className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700"
                                  aria-label={`Add a friend to ${poll.eventTitle}`}
                                >
                                  <option value="">Add friend</option>
                                  {friendsAvailableForPoll.map((friend) => (
                                    <option key={friend.friend.id} value={friend.friend.id}>
                                      {getSmartDisplayName(friend.friend.displayName, allFriendNames)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (selectedPollFriendId) {
                                      addPollFriendMutation.mutate({ scheduleId: poll.id, friendId: selectedPollFriendId });
                                    }
                                  }}
                                  disabled={!selectedPollFriendId || addPollFriendMutation.isPending}
                                  className="min-h-[36px] shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
                                >
                                  Add to poll
                                </button>
                            </div>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          )}

          {upcoming.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">Upcoming events</h2>
                {upcoming.length > 3 && (
                  <span className="text-[11px] font-medium text-gray-400">+{upcoming.length - 3} more</span>
                )}
              </div>
               <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                {upcoming.slice(0, 3).map((m, index) => {
                  const others = m.participants.filter((p) => p.userId !== currentUserId);
                  const displayTitle = m.title || others.map((p) => getSmartDisplayName(p.displayName, allFriendNames)).join(', ');
                  return (
                    <div
                      key={m.id}
                      className={`flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 ${
                        index !== Math.min(upcoming.length, 3) - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex -space-x-1.5 shrink-0">
                        {others.slice(0, 2).map((p) =>
                          p.photoUrl ? (
                            <img
                              key={p.userId}
                              src={p.photoUrl}
                              alt=""
                              className="h-6 w-6 rounded-full ring-2 ring-white"
                              loading="lazy"
                            />
                          ) : (
                            <div
                              key={p.userId}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[10px] font-semibold text-white ring-2 ring-white"
                            >
                              {p.displayName?.[0] ?? '?'}
                            </div>
                          ),
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-700">{displayTitle}</p>
                        <p className="truncate text-[11px] text-gray-400">{formatMeetupTime(m.start_time)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCalendarModal({ meetupId: m.id, title: m.title, startTime: m.start_time, endTime: m.end_time })}
                        className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                          m.calendarAdded
                            ? 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-slotted-200 bg-slotted-50 text-slotted-700 hover:bg-slotted-100'
                        }`}
                      >
                        {m.calendarAdded ? '✓ On calendar' : 'Check calendar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Friend grid (3-col) */}
          {acceptedFriends.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">Who do you want to see?</h2>
                <ShareInviteButton inviteUrl={inviteUrl} variant="inline" />
              </div>
              {!friendTipDismissed && (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-slotted-100 bg-slotted-50/70 px-3 py-1.5">
                  <p className="text-[11px] leading-tight text-slotted-800">
                    Tap a friend, or check multiple for group plans.
                  </p>
                  <button
                    type="button"
                    onClick={dismissFriendTip}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-slotted-500 transition-colors hover:bg-white/70 hover:text-slotted-700"
                    aria-label="Dismiss friend tip"
                  >
                    ×
                  </button>
                </div>
              )}

              {validSavedGroups.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-xs font-medium text-gray-500">Groups</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {validSavedGroups.map((group) => (
                      <div
                        key={group.id}
                        className="flex shrink-0 items-center overflow-hidden rounded-full border border-violet-100 bg-violet-50"
                      >
                        <button
                          onClick={() => openSavedGroup(group.friendIds)}
                          className="min-h-[44px] px-3 text-xs font-semibold text-violet-700"
                        >
                          {group.name}
                        </button>
                        <button
                          onClick={() => deleteSavedGroup(group.id)}
                          className="min-h-[44px] px-2 text-xs font-semibold text-violet-400 hover:text-violet-700"
                          aria-label={`Delete ${group.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedIds.size >= 2 && (
                <div className="flex items-center justify-between mb-2 rounded-lg bg-slotted-50 px-3 py-2">
                  <p className="text-xs font-medium text-slotted-700">
                    {selectedIds.size} friends selected
                  </p>
                  <div className="flex items-center gap-3">
                    {!selectedGroupExists && (
                      <button
                        onClick={saveSelectedGroup}
                        className="text-xs font-semibold text-slotted-700 hover:text-slotted-900"
                      >
                        Save group
                      </button>
                    )}
                    <button
                      onClick={() => { exitSelectMode(); }}
                      className="text-xs text-slotted-600 hover:text-slotted-800 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {visibleFriends.map((f) => {
                  const isSelected = selectedIds.has(f.friend.id);
                  const isViewing = selectedFriendId === f.friend.id;
                  const seen = lastSeenLabel(f);
                  return (
                    <div
                      key={f.friendshipId}
                      className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${
                        isSelected || isViewing
                          ? 'border-slotted-300 bg-slotted-50/60 shadow-sm'
                          : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                      }`}
                    >
                      {/* Checkbox — always visible in top-right */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(f.friend.id);
                          if (!selectMode) setSelectMode(true);
                        }}
                        className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-md border transition-all"
                        style={{ borderColor: isSelected ? 'transparent' : '#d1d5db' }}
                      >
                        {isSelected ? (
                          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slotted-500">
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-md border-2 border-gray-300 bg-white" />
                        )}
                      </button>

                      {/* Tappable avatar + name area */}
                      <button
                        onClick={() => handleRowClick(f)}
                        className="flex flex-col items-center gap-1.5 w-full"
                      >
                        {f.friend.photoUrl ? (
                          <img src={f.friend.photoUrl} alt="" className="h-11 w-11 rounded-full" loading="lazy" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white">
                            {f.friend.displayName?.[0] ?? '?'}
                          </div>
                        )}
                        <p className="text-xs font-medium text-gray-900 truncate max-w-full">
                          {getSmartDisplayName(f.friend.displayName, allFriendNames)}
                        </p>
                        {seen && (
                          <p className="text-[10px] text-gray-500 -mt-0.5">{seen}</p>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {acceptedFriends.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAllFriends((prev) => !prev)}
                  className="mt-2 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {showAllFriends ? 'Show fewer friends' : `Show all ${acceptedFriends.length} friends`}
                </button>
              )}

              {selectedFriendId && !groupFriendIds && (
                <div className="mt-3 scroll-mt-4" ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
                  <FriendAvailability
                    key={selectedFriendId}
                    friendId={selectedFriendId}
                    friendName={selectedFriendName}
                    allFriendNames={allFriendNames}
                    onClose={handleCloseFindTimes}
                    completedHangouts={completedHangoutCount}
                    embedded
                  />
                </div>
              )}

              {groupFriendIds && groupFriendIds.length >= 2 && (
                <div className="mt-3">
                  <GroupAvailability
                    friendIds={groupFriendIds}
                    friendNames={groupFriendIds.map(id => {
                      const f = acceptedFriends.find(fr => fr.friend.id === id);
                      return f?.friend.displayName ?? '';
                    })}
                    allFriendNames={allFriendNames}
                    onClose={() => setGroupFriendIds(null)}
                    embedded
                  />
                </div>
              )}
            </div>
          )}

          {/* 5. Events section */}
          <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/60 to-fuchsia-50/40 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">🎟️</span>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900">Want to do something together?</h2>
                <p className="text-xs text-gray-500 mt-1 mb-3">Browse ideas or search for something specific.</p>
                <EventScheduleButton
                  friends={friendsData}
                  variant="primary"
                  initialMode="browse"
                  label="🎟️ Browse events"
                />
              </div>
            </div>
          </div>

          {/* 7. Friend requests (incoming + outgoing) */}
          {pendingInbound.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Friend Requests</h2>
              <div className="overflow-hidden rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/30">
                {pendingInbound.map((f, i) => (
                  <div
                    key={f.friendshipId}
                    className={`flex items-center justify-between gap-3 px-3 py-3 ${
                      i !== pendingInbound.length - 1 ? 'border-b border-amber-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {f.friend.photoUrl ? (
                        <img src={f.friend.photoUrl} alt="" className="h-9 w-9 rounded-full" loading="lazy" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-semibold text-white">
                          {f.friend.displayName?.[0] ?? '?'}
                        </div>
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">{getSmartDisplayName(f.friend.displayName, allFriendNames)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleFriendAction(f.friendshipId, 'accept')}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-600"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleFriendAction(f.friendshipId, 'decline')}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50"
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outgoingInvites.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Pending</h2>
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                {outgoingInvites.map((f, i) => (
                  <div
                    key={f.friendshipId}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                      i !== outgoingInvites.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {f.friend.photoUrl ? (
                        <img src={f.friend.photoUrl} alt="" className="h-9 w-9 rounded-full" loading="lazy" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-500 text-xs font-semibold text-white">
                          {f.friend.displayName?.[0] ?? '?'}
                        </div>
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">{getSmartDisplayName(f.friend.displayName, allFriendNames)}</p>
                    </div>
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
                      Pending
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
      )}

      {/* Multi-select bottom bar */}
      {selectMode && selectedIds.size >= 1 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => {
              if (selectedIds.size >= 2) {
                setGroupFriendIds(Array.from(selectedIds));
                setSelectedFriendId(null);
                setSelectedFriendName('');
                startTransition(() => {
                  setSearchParams({}, { replace: true });
                });
              } else {
                const friendId = Array.from(selectedIds)[0];
                const friend = acceptedFriends.find(f => f.friend.id === friendId);
                if (friend) handleFindTimes(friend.friend.id, friend.friend.displayName);
              }
              exitSelectMode();
            }}
            className="rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl"
          >
            Let's hang out{selectedIds.size > 1 ? ` (${selectedIds.size} friends)` : ''} →
          </button>
        </div>
      )}
    </AppShell>
  );
}
