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
import api from '../lib/api';
import { getFirstName, getSmartDisplayName, formatMeetupTime } from '../lib/utils';
import { trackFriendInvited, trackFriendAdded } from '../lib/analytics';
import { getUserStage, type UserStage } from '../lib/userStage';
import {
  fetchDashboard,
  fetchFriends,
  fetchMeetups,
  queryKeys,
  type FriendRecord,
} from '../lib/queries';

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

function ShareInviteButton({ inviteUrl, variant }: { inviteUrl: string; variant: 'secondary' | 'subtle' }) {
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

  if (variant === 'subtle') {
    return (
      <button
        onClick={handleShare}
        className="w-full text-center text-xs font-medium text-gray-500 hover:text-slotted-600 transition-colors py-2"
      >
        {copied ? 'Copied!' : 'Invite someone new'}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="w-full rounded-xl border border-gray-200 bg-white px-5 py-3 text-center text-sm font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:border-slotted-300"
    >
      {copied ? 'Copied!' : 'Invite someone new'}
    </button>
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

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const userUid = user?.uid;
  const inviteUrl = `https://slotted-ai.web.app?ref=${userUid ?? ''}`;
  const message = `Let's hang! This app finds times we're both free — no more back-and-forth 📅`;

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

  /* ─── derived data ─── */
  const currentUserId = user?.uid?.replace(/^firebase_/, '') || '';
  const now = useMemo(() => new Date(), []);

  const acceptedFriends = useMemo(
    () => {
      const accepted = friendsData.filter((f) => f.status === 'accepted');
      // Smart sort: overdue friends first, then by recency, then alphabetical
      return accepted.sort((a, b) => {
        // Friends with upcoming meetups go to "coming up" (lower priority — already handled)
        // Overdue friends first (days since / avg cadence, higher = more overdue)
        const aOverdue = (a.daysSinceLastHangout ?? 999) / (a.avgCadenceDays || 14);
        const bOverdue = (b.daysSinceLastHangout ?? 999) / (b.avgCadenceDays || 14);
        // Calendar connected friends before unconnected (actionable first)
        const aActionable = a.friend.calendarConnected ? 1 : 0;
        const bActionable = b.friend.calendarConnected ? 1 : 0;
        if (aActionable !== bActionable) return bActionable - aActionable;
        // Then by overdue-ness
        if (Math.abs(aOverdue - bOverdue) > 0.3) return bOverdue - aOverdue;
        // Fallback: alphabetical
        return getFirstName(a.friend.displayName).localeCompare(getFirstName(b.friend.displayName));
      });
    },
    [friendsData],
  );

  const allFriendNames = useMemo(
    () => friendsData.map((f) => f.friend.displayName),
    [friendsData],
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
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }, []);

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
      {/* Greeting — only for content-heavy stages */}
      {isActiveStage && (
        <div className="mb-5">
          <h1 className="font-display text-xl font-semibold tracking-tight text-gray-900">
            {greeting}, {getFirstName(user?.displayName)}
          </h1>
        </div>
      )}

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

          {/* 2. Upcoming meetups */}
          {upcoming.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Upcoming</h2>
              <div className="space-y-2">
                {upcoming.slice(0, 3).map((m) => {
                  const others = m.participants.filter((p) => p.userId !== currentUserId);
                  const displayTitle = m.title || others.map((p) => getSmartDisplayName(p.displayName, allFriendNames)).join(', ');
                  const isConfirmed = m.status === 'confirmed' || m.participants.every((p) => p.rsvp === 'accepted');
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm cursor-pointer"
                      onClick={() => setCalendarModal({ meetupId: m.id, title: m.title, startTime: m.start_time, endTime: m.end_time })}
                    >
                      <div className="flex -space-x-2 shrink-0">
                        {others.slice(0, 2).map((p) =>
                          p.photoUrl ? (
                            <img
                              key={p.userId}
                              src={p.photoUrl}
                              alt=""
                              className="h-8 w-8 rounded-full ring-2 ring-white"
                              loading="lazy"
                            />
                          ) : (
                            <div
                              key={p.userId}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-white"
                            >
                              {p.displayName?.[0] ?? '?'}
                            </div>
                          ),
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{displayTitle}</p>
                        <p className="text-xs text-gray-500">{formatMeetupTime(m.start_time)}</p>
                      </div>
                      <span
                        className={`shrink-0 text-xs font-medium ${isConfirmed ? 'text-emerald-600' : 'text-amber-600'}`}
                      >
                        {isConfirmed ? '✅' : '⏳'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Friend availability panels (inline) */}
          {selectedFriendId && !groupFriendIds && (
            <div className="scroll-mt-4" ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
              <FriendAvailability
                key={selectedFriendId}
                friendId={selectedFriendId}
                friendName={selectedFriendName}
                allFriendNames={allFriendNames}
                onClose={handleCloseFindTimes}
                completedHangouts={completedHangoutCount}
              />
            </div>
          )}

          {groupFriendIds && groupFriendIds.length >= 2 && (
            <GroupAvailability
              friendIds={groupFriendIds}
              friendNames={groupFriendIds.map(id => {
                const f = acceptedFriends.find(fr => fr.friend.id === id);
                return f?.friend.displayName ?? '';
              })}
              allFriendNames={allFriendNames}
              onClose={() => setGroupFriendIds(null)}
            />
          )}

          {/* 4. Friend grid (3-col) */}
          {acceptedFriends.length > 0 && (
            <div>
              <div className="mb-1">
                <h2 className="text-sm font-semibold text-gray-900">Who do you want to see?</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">Tap to find times · check multiple for group plans</p>

              {selectedIds.size >= 2 && (
                <div className="flex items-center justify-between mb-2 rounded-lg bg-slotted-50 px-3 py-2">
                  <p className="text-xs font-medium text-slotted-700">
                    {selectedIds.size} friends selected
                  </p>
                  <button
                    onClick={() => { exitSelectMode(); }}
                    className="text-xs text-slotted-600 hover:text-slotted-800 font-medium"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {acceptedFriends.map((f) => {
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
            </div>
          )}

          {/* 5. Events section */}
          <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/60 to-fuchsia-50/40 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">🎟️</span>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-gray-900">Want to do something together?</h2>
                <p className="text-xs text-gray-500 mt-1 mb-3">Find shows, concerts, comedy, or things to do near you</p>
                <EventScheduleButton friends={friendsData} variant="primary" />
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

          <ShareInviteButton inviteUrl={inviteUrl} variant="subtle" />

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
