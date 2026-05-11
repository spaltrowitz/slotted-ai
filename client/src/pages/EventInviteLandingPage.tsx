import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFirstName } from '../lib/utils';
import EventShowtimeCard from '../components/EventShowtimeCard';
import type { ScheduleShowtime } from '../components/EventSearchModal';
import api from '../lib/api';

interface EventInviteData {
  valid: boolean;
  eventTitle: string;
  inviterName: string;
  groupMembers: string[];
  venue?: string | null;
  dateCount?: number;
  imageUrl?: string;
  eventScheduleId?: string;
  inviteState?: 'open' | 'reused' | 'reused_existing_only' | 'closed' | 'expired';
  invitesClosed?: boolean;
}

interface EventScheduleData {
  schedule: {
    id: string;
    eventTitle: string;
    eventVenue?: string | null;
    eventImageUrl?: string | null;
    isOwner?: boolean;
    status?: string;
    lifecycleStatus?: 'open' | 'confirmed' | 'expired';
    invitesClosed?: boolean;
    invitesClosedAt?: string | null;
    expiresAt?: string;
    confirmedAt?: string | null;
    confirmedSource?: string | null;
    confirmedMeetupId?: string | null;
    showtimes: {
      datetime: string;
      ticketUrl?: string;
      price?: { min?: number | null; max?: number | null } | null;
    }[];
  };
  votersByShowtime?: string[][];
  totalVoters?: number;
  totalInvited?: number;
}

interface InviteAcceptResponse {
  success: boolean;
  eventTitle: string;
  eventScheduleId: string | null;
  friendsCreated: number;
  userAddedToSchedule: boolean;
  inviteState?: string;
  alreadyInPoll?: boolean;
  calendarSyncFailed?: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const REMOVE_UNDO_MS = 6000;

type PendingRemoval = {
  index: number;
  showtime: EventScheduleData['schedule']['showtimes'][number];
  wasSelected: boolean;
};

export default function EventInviteLandingPage() {
  const { token, scheduleId } = useParams<{ token?: string; scheduleId?: string }>();
  const { user, loading: authLoading, signInWithGoogle, connectCalendar } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<EventInviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [phase, setPhase] = useState<'preview' | 'calendar' | 'vote' | 'done'>('preview');
  const [schedule, setSchedule] = useState<EventScheduleData['schedule'] | null>(null);
  const [votersByShowtime, setVotersByShowtime] = useState<string[][]>([]);
  const [pollParticipantCount, setPollParticipantCount] = useState(0);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [savingVote, setSavingVote] = useState(false);
  const [confirmingDate, setConfirmingDate] = useState(false);
  const [finalShowtimeIndex, setFinalShowtimeIndex] = useState<number | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const removalTimerRef = useRef<number | null>(null);

  // Fetch invite data (no auth required)
  useEffect(() => {
    if (scheduleId) return;
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/events/friend-invite/${token}`);
        if (!res.ok) throw new Error('Invalid invite');
        const data: EventInviteData = await res.json();
        if (!data.valid) {
          setError(data.inviteState === 'expired'
            ? 'This invite expired. Ask your friend to send a fresh link.'
            : "This invite link isn't available anymore.");
          return;
        }
        setInvite(data);
      } catch {
        setError("This invite link isn't valid or has expired. Ask your friend for a new one!");
      } finally {
        setLoading(false);
      }
    })();
  }, [scheduleId, token]);

  useEffect(() => {
    if (!scheduleId || authLoading || !user) return;
    (async () => {
      try {
        const [{ data: scheduleData }, { data: voteData }] = await Promise.all([
          api.get<EventScheduleData>(`/events/schedules/${scheduleId}`),
          api.get<{ selectedIndices: number[]; isOwner: boolean }>(`/events/schedules/${scheduleId}/my-vote`),
        ]);
        setSchedule({ ...scheduleData.schedule, isOwner: voteData.isOwner });
        setVotersByShowtime(scheduleData.votersByShowtime || []);
        setPollParticipantCount(scheduleData.totalInvited || 0);
        setSelectedIndices(new Set(voteData.selectedIndices || []));
        setPhase('vote');
      } catch (err) {
        const status = typeof err === 'object' && err && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
        setError(status === 410
          ? 'This poll expired before the group picked a date.'
          : "This poll isn't available anymore.");
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, scheduleId, user]);

  // After sign-in from a poll link, accept immediately so the person appears in the poll.
  useEffect(() => {
    if (!user || !invite || phase !== 'preview') return;
    acceptInvite();
  }, [user, invite, phase]);

  const acceptInvite = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const { auth } = await import('../lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      await api.post('/users/me', {
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoUrl: currentUser.photoURL,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const idToken = await currentUser.getIdToken();
      const acceptRes = await fetch(`${API_BASE}/events/friend-invite/${token}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!acceptRes.ok) {
        const errorData = await acceptRes.json().catch(() => null) as { code?: string; error?: string } | null;
        if (errorData?.code === 'poll_expired') {
          throw new Error('This poll expired before the group picked a date.');
        }
        if (errorData?.code === 'invites_closed') {
          throw new Error('This poll is no longer adding new people. Ask your friend to reopen invites.');
        }
        throw new Error(errorData?.error || 'Could not accept invite');
      }
      const accepted: InviteAcceptResponse = await acceptRes.json();
      if (accepted.eventScheduleId && !accepted.userAddedToSchedule) {
        throw new Error('Could not add you to the poll');
      }
      if (accepted.calendarSyncFailed) {
        console.warn('Calendar sync failed after accepting event invite.');
      }
      const scheduleId = accepted.eventScheduleId || invite?.eventScheduleId;
      if (scheduleId) {
        const scheduleRes = await fetch(`${API_BASE}/events/schedules/${scheduleId}`);
        if (!scheduleRes.ok) throw new Error('Could not load poll');
        const scheduleData: EventScheduleData = await scheduleRes.json();
        setSchedule(scheduleData.schedule);
        setVotersByShowtime(scheduleData.votersByShowtime || []);
        setPollParticipantCount(scheduleData.totalInvited || 0);
        setSelectedIndices(new Set());
        setPhase('vote');
      } else {
        setPhase('done');
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the poll. Ask your friend for a new link.');
    } finally {
      setAccepting(false);
    }
  };

  const handleJoinClick = async () => {
    if (user) {
      await acceptInvite();
    } else {
      await signInWithGoogle();
    }
  };

  const handleConnectCalendar = async () => {
    // Store token so we can pick up after OAuth redirect
    localStorage.setItem('slotted_pending_event_invite', token || '');
    await connectCalendar();
  };

  const handleSkipCalendar = () => {
    acceptInvite();
  };

  const toggleShowtime = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const saveVote = async () => {
    if (!schedule || selectedIndices.size === 0 || pendingRemoval) return;
    setSavingVote(true);
    setVoteError(null);
    try {
      const { auth } = await import('../lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not signed in');
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/events/schedules/${schedule.id}/vote`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectedIndices: Array.from(selectedIndices) }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null) as { code?: string; error?: string } | null;
        throw new Error(errorData?.code === 'poll_expired'
          ? 'This poll expired before your picks were saved.'
          : errorData?.error || 'Could not save vote');
      }
      setPhase('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Could not save your picks. Try again.');
    } finally {
      setSavingVote(false);
    }
  };

  const confirmFinalDate = async () => {
    if (!schedule || finalShowtimeIndex === null || pendingRemoval) return;
    setConfirmingDate(true);
    setVoteError(null);
    try {
      await api.post(`/events/schedules/${schedule.id}/confirm`, { selectedIndex: finalShowtimeIndex });
      setPhase('done');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err) {
      const status = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { status?: number; data?: { existingMeetupId?: string; error?: string } } }).response?.status
        : undefined;
      setVoteError(status === 409
        ? 'This poll already has a confirmed calendar event.'
        : 'Could not confirm that date. Try again.');
    } finally {
      setConfirmingDate(false);
    }
  };

  const commitPendingRemoval = async (removal: PendingRemoval) => {
    if (!schedule) return;
    setRemovingIndex(removal.index);
    setVoteError(null);
    try {
      const { data } = await api.delete<{ showtimes: EventScheduleData['schedule']['showtimes'] }>(
        `/events/schedules/${schedule.id}/showtimes/${removal.index}`,
      );
      setSchedule((current) => current ? { ...current, showtimes: data.showtimes } : current);
      setVotersByShowtime((current) => current.filter((_, idx) => idx !== removal.index));
    } catch {
      setVoteError('Could not remove that date. It has been restored.');
      restoreRemovedShowtime(removal);
    } finally {
      setRemovingIndex(null);
      setPendingRemoval(null);
    }
  };

  const startRemoveShowtime = (index: number) => {
    if (!schedule || !schedule.isOwner || schedule.showtimes.length <= 1 || pendingRemoval) return;
    const showtime = schedule.showtimes[index];
    const removal: PendingRemoval = {
      index,
      showtime,
      wasSelected: selectedIndices.has(index),
    };

    setPendingRemoval(removal);
    setVoteError(null);
    setSchedule((current) => current
      ? { ...current, showtimes: current.showtimes.filter((_, idx) => idx !== index) }
      : current);
    setVotersByShowtime((current) => current.filter((_, idx) => idx !== index));
    setSelectedIndices((prev) => {
      const next = new Set<number>();
      for (const selectedIndex of prev) {
        if (selectedIndex === index) continue;
        next.add(selectedIndex > index ? selectedIndex - 1 : selectedIndex);
      }
      return next;
    });

    if (removalTimerRef.current) window.clearTimeout(removalTimerRef.current);
    removalTimerRef.current = window.setTimeout(() => {
      commitPendingRemoval(removal);
      removalTimerRef.current = null;
    }, REMOVE_UNDO_MS);
  };

  const restoreRemovedShowtime = (removal: PendingRemoval) => {
    setSchedule((current) => {
      if (!current) return current;
      const restored = [...current.showtimes];
      restored.splice(removal.index, 0, removal.showtime);
      return { ...current, showtimes: restored };
    });
    setSelectedIndices((prev) => {
      const next = new Set<number>();
      for (const selectedIndex of prev) {
        next.add(selectedIndex >= removal.index ? selectedIndex + 1 : selectedIndex);
      }
      if (removal.wasSelected) next.add(removal.index);
      return next;
    });
    setVotersByShowtime((current) => {
      const restored = [...current];
      restored.splice(removal.index, 0, []);
      return restored;
    });
  };

  const undoRemoveShowtime = () => {
    if (!pendingRemoval) return;
    if (removalTimerRef.current) {
      window.clearTimeout(removalTimerRef.current);
      removalTimerRef.current = null;
    }
    restoreRemovedShowtime(pendingRemoval);
    setPendingRemoval(null);
  };

  useEffect(() => () => {
    if (removalTimerRef.current) window.clearTimeout(removalTimerRef.current);
  }, []);

  // Loading state
  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-amber-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-300 border-t-slotted-600" />
      </div>
    );
  }

  // Error state
  if (error || (!invite && !scheduleId)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">😕</div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">
            {error?.includes('expired') ? 'Invite Expired' : error?.includes('no longer adding') ? 'Invites Closed' : 'Invite Not Found'}
          </h1>
          <p className="mb-6 text-sm text-gray-500">{error}</p>
          <Link to="/" className="text-sm font-medium text-slotted-600 hover:text-slotted-700">
            Go to Slotted.ai →
          </Link>
        </div>
      </div>
    );
  }

  // Done state — accepted
  if (phase === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">🎉</div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">{scheduleId ? 'Picks saved!' : "You're in!"}</h1>
          <p className="text-sm text-gray-500">Taking you back to Slotted…</p>
        </div>
      </div>
    );
  }

  if (phase === 'vote' && schedule) {
    const showtimes = schedule.showtimes
      .map((showtime, originalIndex) => {
        const voters: string[] = votersByShowtime[originalIndex] || [];
        return {
          originalIndex,
          voters,
          showtime: {
            datetime: showtime.datetime,
            available: false,
            availabilityState: 'check_incomplete' as const,
            totalParticipants: pollParticipantCount || 0,
            busyCount: 0,
            checkFailedCount: 0,
            ticketUrl: showtime.ticketUrl || '',
            price: showtime.price || null,
          } satisfies ScheduleShowtime,
        };
      })
      .sort((a, b) => new Date(a.showtime.datetime).getTime() - new Date(b.showtime.datetime).getTime());
    const totalVoters = new Set(votersByShowtime.flat()).size || 0;
    const allKnownResponsesIn = Boolean(schedule.isOwner && pollParticipantCount > 0 && totalVoters >= pollParticipantCount);
    const allResponsesIn = Boolean(allKnownResponsesIn && schedule.invitesClosed);
    const bestOverlapCount = showtimes.reduce((best, item) => Math.max(best, item.voters.length), 0);

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-amber-50 px-4 py-6">
        <div className="mx-auto max-w-md space-y-4">
          <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
            {schedule.eventImageUrl && (
              <img
                src={schedule.eventImageUrl}
                alt=""
                className="h-40 w-full object-cover"
                loading="lazy"
              />
            )}
            <div className="p-5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                {allResponsesIn ? 'Ready to pick' : 'Choose dates'}
              </p>
              <h1 className="text-xl font-bold text-gray-900">
                {allResponsesIn
                  ? `Pick the final ${schedule.eventTitle} date`
                  : `Which ${schedule.eventTitle} showtimes work?`}
              </h1>
              {schedule.eventVenue && (
                <p className="mt-1 text-sm text-gray-500">{schedule.eventVenue}</p>
              )}
              <p className="mt-3 text-sm text-gray-600">
                {allResponsesIn
                  ? 'Everyone filled out the poll. Choose the final showtime and Slotted will confirm it for the group.'
                  : allKnownResponsesIn && schedule.isOwner
                    ? 'Everyone currently added has responded. Mark invites complete from your dashboard when everyone has the link.'
                    : schedule.invitesClosed
                      ? 'Invites are closed, so this link only works for people already in the poll. Save your picks so the group can choose.'
                      : 'Select every date you could make. Slotted will compare everyone&rsquo;s picks and find the best overlap.'}
              </p>
              {!schedule.isOwner && schedule.invitesClosed && (
                <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  Invites are closed for new people, but you can still update your own picks.
                </div>
              )}
            {votersByShowtime.some((names) => names.length > 0) && (
              <p className="mt-2 text-xs text-emerald-700">
                Green names show who already picked each showtime, so you can prioritize overlap.
              </p>
            )}
            {schedule.isOwner && (
              <p className="mt-2 text-xs text-amber-700">
                Creator tools: tap the red X to remove a date from this poll.
              </p>
            )}
            </div>
          </div>

          <div className="space-y-2.5 pb-28">
            {showtimes.map(({ showtime, originalIndex, voters }) => (
              <div key={`${showtime.datetime}-${originalIndex}`} className="space-y-1">
                {allResponsesIn && voters.length === bestOverlapCount && (
                  <p className="px-2 text-[11px] font-semibold text-emerald-700">
                    Best overlap
                  </p>
                )}
                <EventShowtimeCard
                  showtime={showtime}
                  selected={allResponsesIn ? finalShowtimeIndex === originalIndex : selectedIndices.has(originalIndex)}
                  onToggle={() => {
                    if (allResponsesIn) setFinalShowtimeIndex(originalIndex);
                    else toggleShowtime(originalIndex);
                  }}
                  disabled={savingVote || confirmingDate || removingIndex === originalIndex}
                  onRemove={!allResponsesIn && schedule.isOwner && schedule.showtimes.length > 1 ? () => startRemoveShowtime(originalIndex) : undefined}
                  removeDisabled={savingVote || confirmingDate || removingIndex === originalIndex || !!pendingRemoval}
                />
              </div>
            ))}
          </div>

          {voteError && (
            <div className="fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
              {voteError}
            </div>
          )}

          {pendingRemoval && (
            <div className="fixed bottom-24 left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
              <span>Date removed</span>
              <button
                type="button"
                onClick={undoRemoveShowtime}
                className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-900"
              >
                Undo
              </button>
            </div>
          )}

          <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm">
            <div className="mx-auto flex max-w-md items-center justify-between gap-3">
               <span className="text-sm text-gray-600">
                {allResponsesIn
                  ? finalShowtimeIndex === null ? 'Pick one final date' : 'Ready to confirm'
                  : selectedIndices.size === 0
                  ? 'Select dates that work'
                  : `${selectedIndices.size} date${selectedIndices.size === 1 ? '' : 's'} selected`}
              </span>
              <button
                onClick={allResponsesIn ? confirmFinalDate : saveVote}
                disabled={allResponsesIn
                  ? finalShowtimeIndex === null || confirmingDate || !!pendingRemoval
                  : selectedIndices.size === 0 || savingVote || !!pendingRemoval}
                className={`min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  allResponsesIn ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-indigo-500 to-blue-500'
                }`}
              >
                {pendingRemoval
                  ? 'Undo or wait…'
                  : allResponsesIn
                    ? confirmingDate ? 'Confirming…' : 'Confirm this date'
                    : savingVote ? 'Saving…' : 'Save my picks'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calendar connect phase
  if (phase === 'calendar') {
    return (
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-amber-50">
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-200/40 via-pink-100/30 to-transparent blur-3xl" />
        <div className="absolute bottom-0 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-amber-200/40 via-orange-100/30 to-transparent blur-3xl" />

        <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
          <div className="w-full rounded-2xl bg-white p-8 shadow-xl text-center space-y-5">
            <div className="text-4xl">📅</div>
            <h1 className="text-xl font-bold text-gray-900">Connect your calendar</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              This is optional, but it helps Slotted double-check your availability before you pick dates.
            </p>

            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 text-left space-y-2">
              <p className="text-xs font-medium text-indigo-800">What we check:</p>
              <ul className="text-xs text-indigo-700 space-y-1">
                <li className="flex items-center gap-2">✓ Only busy/free status</li>
                <li className="flex items-center gap-2">✓ Never event titles or details</li>
                <li className="flex items-center gap-2">✓ Disconnect anytime in settings</li>
              </ul>
            </div>

            <button
              onClick={handleConnectCalendar}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              Connect Google Calendar
            </button>

            <button
              onClick={handleSkipCalendar}
              className="w-full text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip for now — I'll pick times manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main landing page — pre-auth preview
  if (!invite) return null;

  const inviterFirst = getFirstName(invite.inviterName);
  const othersText = invite.groupMembers.length > 0
    ? invite.groupMembers.map(getFirstName).join(', ')
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-amber-50">
      {/* Background blobs */}
      <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-200/40 via-pink-100/30 to-transparent blur-3xl" />
      <div className="absolute bottom-0 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-amber-200/40 via-orange-100/30 to-transparent blur-3xl" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-center px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted.ai</span>
        </Link>
      </nav>

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-80px)] max-w-md flex-col items-center justify-center px-6 pb-12">
        <div className="w-full space-y-5">

          {/* Inviter badge */}
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-gray-100 px-4 py-2 shadow-sm backdrop-blur">
              <span className="text-sm">🎭</span>
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{inviterFirst}</span> invited you!
              </span>
            </div>
          </div>

          {/* Event hero card */}
          <div className="rounded-2xl bg-white p-6 shadow-xl space-y-4">
            {invite.imageUrl && (
              <img
                src={invite.imageUrl}
                alt={invite.eventTitle}
                className="w-full h-40 rounded-xl object-cover"
                loading="lazy"
              />
            )}

            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-gray-900">{invite.eventTitle}</h1>
              {invite.venue && (
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  📍 {invite.venue}
                </p>
              )}
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              {inviterFirst} invited you to pick a showtime
              {invite.groupMembers.length > 0 ? ' together' : ''}!
            </p>

            {/* Social proof */}
            {othersText && (
              <div className="flex items-center gap-2 rounded-xl bg-indigo-50/60 border border-indigo-100/50 px-4 py-3">
                <span className="text-sm">👥</span>
                <p className="text-xs text-indigo-800">
                  {inviterFirst}, {othersText} are also picking a time
                </p>
              </div>
            )}

            {/* Date count */}
            {invite.dateCount && invite.dateCount > 0 && (
              <p className="text-xs text-gray-500">
                🗓️ {invite.dateCount} available date{invite.dateCount > 1 ? 's' : ''} to choose from
              </p>
            )}

            {/* CTA */}
            <button
              onClick={handleJoinClick}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-4 text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
            >
              Join & Pick a Time
            </button>

            <p className="text-center text-xs text-gray-500">
              Free · Google sign-in · Takes 30 seconds
            </p>
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-gray-500">
            Powered by <Link to="/" className="underline hover:text-gray-400">Slotted.ai</Link> — find time to hang with friends
          </p>
        </div>
      </div>
    </div>
  );
}
