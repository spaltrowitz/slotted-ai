import { useState, useMemo, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import AddToCalendarModal from '../components/AddToCalendarModal';
import StarRating from '../components/StarRating';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { getUserStage, type UserStage } from '../lib/userStage';
import {
  fetchDashboard,
  fetchFriends,
  fetchMeetups,
  queryKeys,
  type FriendRecord,
  type FriendToSee,
  type Meetup,
} from '../lib/queries';

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

function formatMeetupTime(start: string) {
  const d = new Date(start);
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  );
}

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
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

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
  onAccept,
  onDecline,
  accepting,
}: {
  invites: FriendRecord[];
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
        {primary.friend.displayName} wants to connect!
      </h2>
      {othersCount > 0 && (
        <p className="mt-1 text-sm text-gray-400">
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

function StageOneFriend({
  friends,
}: {
  friends: FriendRecord[];
}) {
  const recent = friends[friends.length - 1];

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h2 className="text-xl font-semibold text-gray-900">
        You and {recent.friend.displayName} are connected! ❤️
      </h2>
      <p className="mt-3 max-w-xs text-sm text-gray-500 leading-relaxed">
        Ready to find time to hang out?
      </p>
      <Link
        to={`/friends?findTimes=${recent.friend.id}`}
        className="mt-8 rounded-xl gradient-btn px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
      >
        Find times with {recent.friend.displayName.split(' ')[0]} →
      </Link>
    </div>
  );
}

function StageHasHangouts({
  upcoming,
  inviteUrl,
  currentUserId,
  onExpand: _onExpand,
  expandedId: _expandedId,
  calendarModal,
  onCalendarModal,
}: {
  upcoming: Meetup[];
  inviteUrl: string;
  currentUserId: string;
  onExpand: (id: string | null) => void;
  expandedId: string | null;
  calendarModal: { meetupId: string; title: string; startTime: string; endTime: string } | null;
  onCalendarModal: (m: { meetupId: string; title: string; startTime: string; endTime: string } | null) => void;
}) {
  const hero = upcoming[0];
  const others = hero.participants.filter((p) => p.userId !== currentUserId);
  const displayTitle = hero.title || others.map((p) => p.displayName.split(' ')[0]).join(', ');

  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold text-gray-900">Coming up</h2>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-gray-900">{displayTitle}</p>
        <p className="mt-1 text-xs text-gray-400">{formatMeetupTime(hero.start_time)}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex -space-x-2">
            {others.slice(0, 3).map((p) =>
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
          <button
            onClick={() => onCalendarModal({ meetupId: hero.id, title: hero.title, startTime: hero.start_time, endTime: hero.end_time })}
            className="text-xs font-medium text-slotted-600 hover:text-slotted-700 transition-colors"
          >
            View →
          </button>
        </div>
      </div>

      {upcoming.length > 1 && (
        <div className="space-y-2">
          {upcoming.slice(1, 4).map((m) => {
            const mOthers = m.participants.filter((p) => p.userId !== currentUserId);
            const mTitle = m.title || mOthers.map((p) => p.displayName.split(' ')[0]).join(', ');
            return (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{mTitle}</p>
                  <p className="text-xs text-gray-400">{formatMeetupTime(m.start_time)}</p>
                </div>
                <button
                  onClick={() => onCalendarModal({ meetupId: m.id, title: m.title, startTime: m.start_time, endTime: m.end_time })}
                  className="shrink-0 text-xs font-medium text-slotted-600 hover:text-slotted-700 transition-colors"
                >
                  View →
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 pt-2">
        <Link
          to="/friends"
          className="rounded-xl gradient-btn px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
        >
          Find times with a friend
        </Link>
        <ShareInviteButton inviteUrl={inviteUrl} variant="secondary" />
      </div>

      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => onCalendarModal(null)}
        />
      )}
    </div>
  );
}

function StageActiveUser({
  upcoming,
  friendsToSee,
  inviteUrl,
  currentUserId,
  calendarModal,
  onCalendarModal,
}: {
  upcoming: Meetup[];
  friendsToSee: FriendToSee[];
  inviteUrl: string;
  currentUserId: string;
  calendarModal: { meetupId: string; title: string; startTime: string; endTime: string } | null;
  onCalendarModal: (m: { meetupId: string; title: string; startTime: string; endTime: string } | null) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.slice(0, 3).map((m) => {
              const others = m.participants.filter((p) => p.userId !== currentUserId);
              const displayTitle = m.title || others.map((p) => p.displayName.split(' ')[0]).join(', ');
              const isConfirmed = m.status === 'confirmed' || m.participants.every((p) => p.rsvp === 'accepted');
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
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
                    <p className="text-xs text-gray-400">{formatMeetupTime(m.start_time)}</p>
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

      {upcoming.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
          <p className="text-sm text-gray-500">No upcoming hangouts</p>
          <Link
            to="/friends"
            className="mt-3 inline-block rounded-xl gradient-btn px-5 py-2.5 text-xs font-semibold text-white shadow-sm"
          >
            Find a time with a friend
          </Link>
        </div>
      )}

      {/* Time to reconnect */}
      {friendsToSee.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Time to reconnect?</h2>
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            {friendsToSee.slice(0, 4).map((f) => (
              <Link
                key={f.id}
                to={`/friends?findTimes=${f.id}`}
                className="flex flex-shrink-0 flex-col items-center gap-1.5 w-16 group"
              >
                {f.photoUrl ? (
                  <img
                    src={f.photoUrl}
                    alt=""
                    className="h-12 w-12 rounded-full ring-2 ring-white shadow-sm group-hover:ring-slotted-300 transition-all"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white shadow-sm ring-2 ring-white group-hover:ring-slotted-300 transition-all">
                    {f.displayName?.[0] ?? '?'}
                  </div>
                )}
                <p className="w-full text-center text-xs font-medium text-gray-600 group-hover:text-slotted-600 transition-colors truncate">
                  {f.displayName?.split(' ')[0]}
                </p>
                {f.lastHangout && (
                  <p className="text-[10px] text-gray-400">{timeAgo(f.lastHangout)}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Invite CTA */}
      <ShareInviteButton inviteUrl={inviteUrl} variant="subtle" />

      {calendarModal && (
        <AddToCalendarModal
          meetupId={calendarModal.meetupId}
          meetupTitle={calendarModal.title}
          startTime={calendarModal.startTime}
          endTime={calendarModal.endTime}
          onClose={() => onCalendarModal(null)}
        />
      )}
    </div>
  );
}

function ShareInviteButton({ inviteUrl, variant }: { inviteUrl: string; variant: 'secondary' | 'subtle' }) {
  const [copied, setCopied] = useState(false);
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

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
        className="w-full text-center text-xs font-medium text-gray-400 hover:text-slotted-600 transition-colors py-2"
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

  const [expandedMeetupId, setExpandedMeetupId] = useState<string | null>(null);
  const [calendarModal, setCalendarModal] = useState<{
    meetupId: string;
    title: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  const today = new Date();
  const greeting =
    today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const userUid = user?.uid;
  const inviteUrl = `https://slotted-ai.web.app?ref=${userUid ?? ''}`;

  /* ─── data fetching ─── */
  const { data: friendsToSee = [], isLoading: dashboardLoading } = useQuery({
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
    () => friendsData.filter((f) => f.status === 'accepted'),
    [friendsData],
  );

  const pendingInbound = useMemo(
    () => friendsData.filter((f) => f.status === 'pending' && f.invitedBy === f.friend.id),
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

  const stage: UserStage = useMemo(
    () =>
      getUserStage({
        calendarConnected,
        friendCount: acceptedFriends.length,
        pendingInvitesCount: pendingInbound.length,
        completedHangoutCount: completedHangouts.length,
        upcomingHangoutCount: upcoming.length,
      }),
    [calendarConnected, acceptedFriends.length, pendingInbound.length, completedHangouts.length, upcoming.length],
  );

  const isLoading = dashboardLoading;

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
    return others[0]?.displayName?.split(' ')[0] || 'your friend';
  }, [meetupToRate, currentUserId]);

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

  /* ─── render ─── */
  return (
    <AppShell>
      {/* Greeting — only for content-heavy stages */}
      {(stage === 'has-hangouts' || stage === 'active-user') && (
        <div className="mb-5">
          <h1 className="font-display text-xl font-semibold tracking-tight text-gray-900">
            {greeting}, {user?.displayName?.split(' ')[0]}
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
          onAccept={(id) => friendActionMutation.mutate({ friendshipId: id, action: 'accept' })}
          onDecline={(id) => friendActionMutation.mutate({ friendshipId: id, action: 'decline' })}
          accepting={friendActionMutation.isPending}
        />
      )}

      {!isLoading && stage === 'one-friend' && (
        <StageOneFriend friends={acceptedFriends} />
      )}

      {!isLoading && stage === 'has-hangouts' && (
        <StageHasHangouts
          upcoming={upcoming}
          inviteUrl={inviteUrl}
          currentUserId={currentUserId}
          onExpand={setExpandedMeetupId}
          expandedId={expandedMeetupId}
          calendarModal={calendarModal}
          onCalendarModal={setCalendarModal}
        />
      )}

      {!isLoading && stage === 'active-user' && (
        <StageActiveUser
          upcoming={upcoming}
          friendsToSee={friendsToSee}
          inviteUrl={inviteUrl}
          currentUserId={currentUserId}
          calendarModal={calendarModal}
          onCalendarModal={setCalendarModal}
        />
      )}
    </AppShell>
  );
}
