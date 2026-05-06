import { useState, useEffect, useMemo, startTransition } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { trackFriendInvited, trackInviteLinkCopied, trackFriendAdded } from '../lib/analytics';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';
import EventScheduleButton from '../components/EventScheduleButton';
import api from '../lib/api';
import { getSmartDisplayName } from '../lib/utils';
import {
  fetchFriends,
  fetchMeetups,
  queryKeys,
  type FriendRecord,
} from '../lib/queries';

export default function FriendsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [copied, setCopied] = useState(false);

  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string>('');

  const [removingFriend, setRemovingFriend] = useState<FriendRecord | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Group availability state
  const [groupFriendIds, setGroupFriendIds] = useState<string[] | null>(null);

  const inviteUrl = `https://slotted-ai.web.app?ref=${user?.uid ?? ''}`;
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

  const { data: friends = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.friends,
    queryFn: fetchFriends,
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  const { data: meetups = [] } = useQuery({
    queryKey: queryKeys.meetups,
    queryFn: fetchMeetups,
    enabled: !!user,
  });

  const completedHangouts = useMemo(() => {
    const now = new Date();
    return meetups.filter((m) => {
      const end = new Date(m.end_time);
      return end < now && (m.status === 'confirmed' || (m.status === 'proposed' && m.myRsvp === 'accepted'));
    }).length;
  }, [meetups]);

  const friendActionMutation = useMutation({
    mutationFn: async ({ friendshipId, action }: { friendshipId: string; action: 'accept' | 'decline' }) => {
      await api.patch(`/friends/${friendshipId}`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
  });

  const removeFriendMutation = useMutation({
    mutationFn: async (friendshipId: string) => {
      await api.delete(`/friends/${friendshipId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
  });

  useEffect(() => {
    const findTimesId = searchParams.get('findTimes');
    if (findTimesId && friends.length > 0) {
      const friend = friends.find(f => f.friend.id === findTimesId && f.status === 'accepted');
      if (friend) {
        setSelectedFriendId(findTimesId);
        setSelectedFriendName(friend.friend.displayName);
      }
    }
  }, [searchParams, friends]);

  const handleFindTimes = (friendId: string, friendName: string) => {
    setSelectedFriendId(friendId);
    setSelectedFriendName(friendName);
    setGroupFriendIds(null);
    setSearchParams({ findTimes: friendId });
  };

  const handleCloseFindTimes = () => {
    setSelectedFriendId(null);
    setSelectedFriendName('');
    startTransition(() => {
      setSearchParams({}, { replace: true });
    });
  };

  const handleFriendAction = async (friendshipId: string, action: 'accept' | 'decline') => {
    if (!user) return;
    try {
      await friendActionMutation.mutateAsync({ friendshipId, action });
      if (action === 'accept') trackFriendAdded();
    } catch (err) {
      console.error('Failed to update friendship:', err);
    }
  };

  const handleRemoveFriend = async () => {
    if (!user || !removingFriend) return;
    setRemoveLoading(true);
    try {
      await removeFriendMutation.mutateAsync(removingFriend.friendshipId);
      setRemovingFriend(null);
    } catch (err) {
      console.error('Failed to remove friend:', err);
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleText = () => {
    trackFriendInvited('sms');
    window.open(`sms:?&body=${encodeURIComponent(message)}`, '_blank');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    trackInviteLinkCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleSelect = (friendId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  };

  const handleRowClick = (f: FriendRecord) => {
    if (selectMode) {
      toggleSelect(f.friend.id);
    } else {
      handleFindTimes(f.friend.id, f.friend.displayName);
    }
  };

  const handleLongPress = (f: FriendRecord) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(new Set([f.friend.id]));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (selectedIds.size === 0 && selectMode) {
      setSelectMode(false);
    }
  }, [selectedIds, selectMode]);

  const incomingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy === f.friend.id
  );
  const outgoingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy !== f.friend.id
  );
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');

  const allFriendNames = useMemo(
    () => friends.map((f) => f.friend.displayName),
    [friends],
  );

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

  const renderFriendRow = (f: FriendRecord, i: number, arr: FriendRecord[]) => {
    const isSelected = selectedIds.has(f.friend.id);
    const seen = lastSeenLabel(f);
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleSelect(f.friend.id);
      if (!selectedIds.has(f.friend.id)) {
        setSelectMode(true);
      }
    };

    return (
      <div
        key={f.friendshipId}
        role="button"
        tabIndex={0}
        onClick={() => handleRowClick(f)}
        onContextMenu={(e) => { e.preventDefault(); handleLongPress(f); }}
        onTouchStart={() => { longPressTimer = setTimeout(() => handleLongPress(f), 500); }}
        onTouchEnd={() => { if (longPressTimer) clearTimeout(longPressTimer); }}
        onTouchMove={() => { if (longPressTimer) clearTimeout(longPressTimer); }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleRowClick(f); }}
        className={`flex items-center gap-3 px-3 py-2.5 transition-colors cursor-pointer active:bg-gray-100 ${
          i !== arr.length - 1 ? 'border-b border-gray-100' : ''
        } ${isSelected ? 'bg-slotted-50/60' : 'hover:bg-gray-50/50'}`}
      >
        <div className="flex shrink-0 items-center justify-center" style={{ minWidth: 44, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={handleCheckboxClick}
            className="h-4 w-4 rounded border-gray-300 text-slotted-500 focus:ring-slotted-400 cursor-pointer"
          />
        </div>

        <div className="relative shrink-0">
          {f.friend.photoUrl ? (
            <img src={f.friend.photoUrl} alt="" className="h-9 w-9 rounded-full" loading="lazy" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xs font-semibold text-white">
              {f.friend.displayName?.[0] ?? '?'}
            </div>
          )}
          {selectMode && isSelected && (
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slotted-500 text-white">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {getSmartDisplayName(f.friend.displayName, allFriendNames)}
            {seen && <span className="ml-1.5 text-xs font-normal text-gray-400"> · {seen}</span>}
          </p>
        </div>

        <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Friends</h1>
          {acceptedFriends.length > 1 && (
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Your people
        </p>
      </div>

      {selectedFriendId && !groupFriendIds && (
        <div className="mb-6">
          <FriendAvailability
            key={selectedFriendId}
            friendId={selectedFriendId}
            friendName={selectedFriendName}
            allFriendNames={allFriendNames}
            onClose={handleCloseFindTimes}
            completedHangouts={completedHangouts}
          />
        </div>
      )}

      {groupFriendIds && groupFriendIds.length >= 2 && (
        <div className="mb-6">
          <GroupAvailability
            friendIds={groupFriendIds}
            friendNames={groupFriendIds.map(id => {
              const f = acceptedFriends.find(fr => fr.friend.id === id);
              return f?.friend.displayName ?? '';
            })}
            allFriendNames={allFriendNames}
            onClose={() => setGroupFriendIds(null)}
          />
        </div>
      )}

      {/* Incoming invites */}
      {incomingInvites.length > 0 && (
        <div className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Friend Requests</h2>
          <div className="overflow-hidden rounded-xl border border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/30">
            {incomingInvites.map((f, i) => (
              <div
                key={f.friendshipId}
                className={`flex items-center justify-between gap-3 px-3 py-3 ${
                  i !== incomingInvites.length - 1 ? 'border-b border-amber-100' : ''
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

      {/* Outgoing invites */}
      {outgoingInvites.length > 0 && (
        <div className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Pending</h2>
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

      {/* Selection count header */}
      {selectMode && acceptedFriends.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-gray-500">
            {selectedIds.size} of {acceptedFriends.length} selected
          </p>
        </div>
      )}

      {/* Friend list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-400 border-t-transparent" />
        </div>
      ) : acceptedFriends.length === 0 && incomingInvites.length === 0 && outgoingInvites.length === 0 ? (
        <div className="rounded-xl border border-slotted-200/60 bg-gradient-to-br from-slotted-50/60 to-purple-50/40 overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <h3 className="font-display text-lg font-bold text-gray-900">
              Ready to connect?
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-500 leading-relaxed">
              Share your invite link and Slotted.ai will find the best times for you to hang out together.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={handleText} className="flex items-center gap-2 rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                Text a friend
              </button>
              <button onClick={handleCopy} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300">
                {copied ? 'Copied!' : 'Copy invite link'}
              </button>
            </div>
          </div>
        </div>
      ) : acceptedFriends.length > 0 && (
        <div className="mb-4">
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
            {acceptedFriends.map((f, i) => renderFriendRow(f, i, acceptedFriends))}
          </div>
        </div>
      )}

      {/* + Invite a friend row */}
      {acceptedFriends.length > 0 && (
        <div className="mb-6">
          <button
            onClick={handleText}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            Invite a friend
          </button>
        </div>
      )}

      {/* Multi-select bottom bar */}
      {selectMode && selectedIds.size >= 1 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center gap-2 px-4">
          {selectedIds.size >= 2 && (
            <button
              onClick={() => {
                setGroupFriendIds(Array.from(selectedIds));
                setSelectedFriendId(null);
                setSelectedFriendName('');
                startTransition(() => {
                  setSearchParams({}, { replace: true });
                });
                exitSelectMode();
              }}
              className="rounded-xl gradient-btn px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl"
            >
              Find time for {selectedIds.size} friends →
            </button>
          )}
          <EventScheduleButton
            friends={friends}
            preselectedFriendIds={Array.from(selectedIds)}
            variant="compact"
          />
        </div>
      )}

      {/* Remove friend confirmation modal */}
      {removingFriend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !removeLoading && setRemovingFriend(null)}>
          <div className="w-full max-w-[calc(100vw-1.5rem)] sm:max-w-sm rounded-2xl bg-white px-4 py-5 sm:p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Remove friend?</h3>
              <p className="mt-2 text-sm text-gray-500">
                Are you sure you want to remove <span className="font-medium text-gray-700">{getSmartDisplayName(removingFriend.friend.displayName, allFriendNames)}</span>? You won't be able to see each other's availability anymore.
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setRemovingFriend(null)}
                disabled={removeLoading}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveFriend}
                disabled={removeLoading}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {removeLoading ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

    </AppShell>
  );
}
