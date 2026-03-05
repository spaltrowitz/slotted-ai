import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { trackFriendInvited, trackInviteLinkCopied, trackFriendAdded } from '../lib/analytics';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';
import api from '../lib/api';
import {
  fetchFriends,
  fetchGroups,
  fetchUserSettings,
  queryKeys,
  type FriendRecord,
  type SavedGroup,
} from '../lib/queries';

const INTEREST_LABELS: Record<string, { emoji: string; label: string }> = {
  theater: { emoji: '🎭', label: 'Theater' },
  concerts: { emoji: '🎵', label: 'Concerts' },
  sports: { emoji: '⚽', label: 'Sports' },
  comedy: { emoji: '😂', label: 'Comedy' },
  festivals: { emoji: '🎪', label: 'Festivals' },
  dance: { emoji: '💃', label: 'Dance' },
  opera: { emoji: '🎻', label: 'Classical' },
};

export default function FriendsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [copied, setCopied] = useState(false);

  // Find times state
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string>('');

  // Group availability state
  const [showGroupAvailability, setShowGroupAvailability] = useState(false);
  const [groupFriendIds, setGroupFriendIds] = useState<string[]>([]);
  const [groupFriendNames, setGroupFriendNames] = useState<string[]>([]);

  // Saved groups
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [createGroupSelectedIds, setCreateGroupSelectedIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const [inviteEmailInput, setInviteEmailInput] = useState('');

  // Remove friend state
  const [removingFriend, setRemovingFriend] = useState<FriendRecord | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [showAddLongDistancePicker, setShowAddLongDistancePicker] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string } | null>(null);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);



  // Add member to group state
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [addingMemberIds, setAddingMemberIds] = useState<Set<string>>(new Set());

  const inviteUrl = `https://slotted-ai.web.app?ref=${user?.uid ?? ''}`;
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

  const { data: friends = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.friends,
    queryFn: fetchFriends,
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  const { data: groups = [] } = useQuery({
    queryKey: queryKeys.groups,
    queryFn: fetchGroups,
    enabled: !!user,
  });

  const { data: settingsData } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchUserSettings,
    enabled: !!user,
  });

  const myEventInterests = settingsData?.event_interests ?? [];

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

  const updateFriendshipTypeMutation = useMutation({
    mutationFn: async ({ friendshipId, friendshipType }: { friendshipId: string; friendshipType: 'local' | 'long_distance' }) => {
      await api.patch(`/friends/${friendshipId}`, { friendshipType });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; memberIds: string[]; invitedEmails?: string[] }) => {
      await api.post('/groups', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      await api.delete(`/groups/${groupId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, memberId }: { groupId: string; memberId: string }) => {
      await api.post(`/groups/${groupId}/members`, { memberIds: [memberId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });

  const inviteFriendMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await api.post('/friends/invite', { userId: memberId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
    },
  });

  // Auto-open FriendAvailability from URL param
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
    setShowGroupAvailability(false);
    setSearchParams({ findTimes: friendId });
  };

  const handleCloseFindTimes = () => {
    setSelectedFriendId(null);
    setSelectedFriendName('');
    setSearchParams({});
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

  const handleToggleFriendshipType = async (friendship: FriendRecord, targetType: 'local' | 'long_distance') => {
    if (!user) return;
    const previousFriends = queryClient.getQueryData<FriendRecord[]>(queryKeys.friends) ?? friends;
    queryClient.setQueryData(
      queryKeys.friends,
      previousFriends.map(f =>
        f.friendshipId === friendship.friendshipId
          ? { ...f, friendshipType: targetType }
          : f
      ),
    );
    try {
      await updateFriendshipTypeMutation.mutateAsync({
        friendshipId: friendship.friendshipId,
        friendshipType: targetType,
      });
      return true;
    } catch (err) {
      console.error('Failed to update friendship type:', err);
      queryClient.setQueryData(queryKeys.friends, previousFriends);
      alert('Failed to update friend location. Please try again.');
      return false;
    }
  };

  const handleText = () => {
    trackFriendInvited('sms');
    window.open(`sms:?&body=${encodeURIComponent(message)}`, '_blank');
  };

  const handleEmail = () => {
    trackFriendInvited('email');
    window.location.href = `mailto:?subject=${encodeURIComponent("Let's hang — try Slotted.ai!")}&body=${encodeURIComponent(message)}`;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    trackInviteLinkCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleGroupFindTimes = (group: SavedGroup) => {
    const ids = group.members.map(m => m.id);
    const names = group.members.map(m => m.displayName);
    setGroupFriendIds(ids);
    setGroupFriendNames(names);
    setShowGroupAvailability(true);
    setSelectedFriendId(null);
  };

  const handleAddInviteEmail = () => {
    const email = inviteEmailInput.trim().toLowerCase();
    if (!email) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    // Don't add duplicates
    if (invitedEmails.includes(email)) { setInviteEmailInput(''); return; }
    // Don't add if already a friend
    if (acceptedFriends.some(f => f.friend.email.toLowerCase() === email)) { setInviteEmailInput(''); return; }
    setInvitedEmails(prev => [...prev, email]);
    setInviteEmailInput('');
  };

  const handleRemoveInviteEmail = (email: string) => {
    setInvitedEmails(prev => prev.filter(e => e !== email));
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || (createGroupSelectedIds.size + invitedEmails.length) < 2 || !user) return;
    // Nudge users creating a 2-person "group" toward 1:1 Find Times
    const totalMembers = createGroupSelectedIds.size + invitedEmails.length + 1; // +1 for creator
    if (totalMembers <= 2 && invitedEmails.length === 0) {
      const useGroup = window.confirm(
        'Tip: For 1-on-1 hangouts, you can tap a friend directly and use "Find Times" — it\'s faster!\n\nGroups work best for 3+ people. Create this group anyway?'
      );
      if (!useGroup) return;
    }
    setCreatingGroup(true);
    try {
      await createGroupMutation.mutateAsync({
        name: newGroupName.trim(),
        memberIds: Array.from(createGroupSelectedIds),
        invitedEmails: invitedEmails.length > 0 ? invitedEmails : undefined,
      });
      setNewGroupName('');
      setCreateGroupSelectedIds(new Set());
      setInvitedEmails([]);
      setInviteEmailInput('');
      setShowCreateGroup(false);
    } catch {
      // silent
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!user) return;
    setDeleteGroupLoading(true);
    try {
      await deleteGroupMutation.mutateAsync(groupId);
      setDeletingGroup(null);
      setAddMemberGroupId((current) => (current === groupId ? null : current));
    } catch (err) {
      console.error('Failed to delete group:', err);
    } finally {
      setDeleteGroupLoading(false);
    }
  };

  const [addedMemberIds, setAddedMemberIds] = useState<Set<string>>(new Set());

  const handleAddMemberToGroup = async (groupId: string, memberId: string) => {
    setAddingMemberIds((prev) => new Set(prev).add(memberId));
    try {
      await addMemberMutation.mutateAsync({ groupId, memberId });
      setAddedMemberIds((prev) => new Set(prev).add(memberId));
      // Clear the success state after 2 seconds
      setTimeout(() => setAddedMemberIds((prev) => { const next = new Set(prev); next.delete(memberId); return next; }), 2000);
    } catch (err) {
      console.error('Failed to add member to group:', err);
    } finally {
      setAddingMemberIds((prev) => { const next = new Set(prev); next.delete(memberId); return next; });
    }
  };

  const toggleCreateGroupFriend = (id: string) => {
    setCreateGroupSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const incomingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy === f.friend.id
  );
  const outgoingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy !== f.friend.id
  );
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const localFriends = acceptedFriends.filter((f) => (f.friendshipType || 'local') === 'local');
  const longDistanceFriends = acceptedFriends.filter((f) => f.friendshipType === 'long_distance');

  // Track all friend IDs (accepted + pending) so we know who we're already connected/pending with
  const connectedOrPendingIds = new Set(friends.map((f) => f.friend.id));

  // State for group member friend requests in progress
  const [groupFriendRequesting, setGroupFriendRequesting] = useState<Set<string>>(new Set());
  const [groupFriendRequested, setGroupFriendRequested] = useState<Set<string>>(new Set());

  const handleGroupMemberFriendRequest = async (memberId: string) => {
    setGroupFriendRequesting((prev) => new Set(prev).add(memberId));
    try {
      await inviteFriendMutation.mutateAsync(memberId);
      setGroupFriendRequested((prev) => new Set(prev).add(memberId));
    } catch (err) {
      console.error('Failed to send friend request:', err);
    } finally {
      setGroupFriendRequesting((prev) => { const next = new Set(prev); next.delete(memberId); return next; });
    }
  };

  const batteryEmoji = (battery?: string) => {
    if (battery === 'open') return '🟢';
    if (battery === 'ask_me') return '🟡';
    if (battery === 'recharging') return '🔴';
    return '';
  };

  const batteryLabel = (battery?: string) => {
    if (battery === 'open') return 'Open to hang';
    if (battery === 'ask_me') return 'Ask me';
    if (battery === 'recharging') return 'Recharging';
    return '';
  };

  /** Render a single friend row */
  const renderFriendCard = (f: FriendRecord, i: number, arr: FriendRecord[]) => (
    <div
      key={f.friendshipId}
      className={`flex items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 transition-colors hover:bg-gray-50/50 ${
        i !== arr.length - 1 ? 'border-b border-gray-100' : ''
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        {f.friend.photoUrl ? (
          <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" loading="lazy" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white">
            {f.friend.displayName?.[0] ?? '?'}
          </div>
        )}
        <div className="min-w-0 w-full">
          <p className="text-sm sm:text-sm font-medium text-gray-900 truncate">
            {f.friend.displayName}
            {f.friend.socialBattery && (
              <span className="ml-1.5 relative hidden sm:inline-flex items-center gap-1 group cursor-default">
                {batteryEmoji(f.friend.socialBattery)}
                <span className="text-[10px] text-gray-400 md:hidden">{batteryLabel(f.friend.socialBattery)}</span>
                <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 md:block">
                  {batteryLabel(f.friend.socialBattery)}
                </span>
              </span>
            )}
          </p>
          <p className="hidden sm:block text-xs text-gray-400 truncate">
            {f.friend.email}
            <span className={`ml-2 inline-flex items-center gap-0.5 ${f.friend.calendarConnected ? 'text-green-500' : 'text-gray-300'}`}>
              {f.friend.calendarConnected ? '📅' : '📅'}
              <span className="text-[10px]">{f.friend.calendarConnected ? 'Cal synced' : 'No cal'}</span>
            </span>
          </p>
          {/* Shared event interests */}
          {(() => {
            const shared = (f.friend.eventInterests || []).filter(i => myEventInterests.includes(i));
            return shared.length > 0 ? (
              <div className="mt-1 hidden sm:flex flex-wrap gap-1">
                {shared.map(i => {
                  const info = INTEREST_LABELS[i];
                  return info ? (
                    <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-slotted-50 border border-slotted-100 px-1.5 py-0.5 text-[10px] font-medium text-slotted-600">
                      {info.emoji} {info.label}
                    </span>
                  ) : null;
                })}
              </div>
            ) : null;
          })()}
          {/* Hangout cadence — only show after 2+ logged hangouts */}
          {f.lastHangoutDate && (f.totalHangouts ?? 0) >= 2 && (() => {
            const days = f.daysSinceLastHangout ?? 0;
            const cadence = f.avgCadenceDays;
            const isOverdue = cadence && days > cadence;
            const firstName = f.friend.displayName.split(' ')[0];
            return (
              <div className={`mt-1.5 hidden sm:flex items-center gap-1.5 text-[11px] leading-tight ${
                isOverdue ? 'text-amber-600' : 'text-gray-400'
              }`}>
                <span>{isOverdue ? '⏰' : '📅'}</span>
                <span>
                  {days === 0
                    ? 'Hung out today'
                    : days === 1
                      ? 'Hung out yesterday'
                      : `Last hung out ${days}d ago`}
                  {cadence ? (
                    <span className="text-gray-400"> · typically every {cadence}d</span>
                  ) : null}
                  {isOverdue ? (
                    <span className="font-medium text-amber-600"> — time to catch up with {firstName}!</span>
                  ) : null}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => handleFindTimes(f.friend.id, f.friend.displayName)}
          className={`rounded-xl px-2.5 py-2 sm:px-3 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
            selectedFriendId === f.friend.id
              ? 'bg-slotted-500 text-white'
              : 'gradient-btn text-white'
          }`}
        >
          {selectedFriendId === f.friend.id ? '✨ Viewing' : '✨ Find times'}
        </button>
        <button
          onClick={() => setRemovingFriend(f)}
          className="hidden sm:inline-flex rounded-lg p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          title="Remove friend"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Friends</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your people. See who's around and feeling social 🫶
        </p>
      </div>

      {/* FIND TIMES panel (1:1) */}
      {selectedFriendId && (
        <div className="mb-6">
          <FriendAvailability
            friendId={selectedFriendId}
            friendName={selectedFriendName}
            onClose={handleCloseFindTimes}
          />
        </div>
      )}

      {/* GROUP AVAILABILITY panel */}
      {showGroupAvailability && groupFriendIds.length > 0 && (
        <div className="mb-6">
          <GroupAvailability
            friendIds={groupFriendIds}
            friendNames={groupFriendNames}
            onClose={() => { setShowGroupAvailability(false); setGroupFriendIds([]); setGroupFriendNames([]); }}
          />
        </div>
      )}

      {/* Invite friends — share link */}
      <div className="relative mb-5">
        <p className="text-sm text-gray-500 mb-3">Invite friends to Slotted.ai so you can find the best times to hang out.</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleText} className="flex items-center gap-2 rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
            📱 Text
          </button>
          <button onClick={handleEmail} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300">
            📧 Email
          </button>
          <button onClick={handleCopy} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300">
            {copied ? '✅ Copied!' : '📋 Copy link'}
          </button>
        </div>
      </div>

      {/* Groups Section — always visible */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            👥 Groups {groups.length > 0 ? `· ${groups.length}` : ''}
          </h2>
          {!showCreateGroup && (
            <button
              onClick={() => setShowCreateGroup(true)}
              className="text-xs font-semibold text-purple-600 hover:text-purple-700 transition-colors"
            >
              + New group
            </button>
          )}
        </div>

        {groups.length > 0 && (
          <div className="space-y-2 mb-3">
            {groups.map(group => {
              const nonFriendMembers = group.members.filter(m => !connectedOrPendingIds.has(m.id));
              return (
                <div key={group.id} className="rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/30 to-fuchsia-50/20 px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-lg shrink-0">👥</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {[
                            ...group.members.map(m => m.displayName.split(' ')[0]),
                            ...(group.pendingEmails || []).map(e => `${e} ⏳`),
                          ].join(', ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleGroupFindTimes(group)}
                        className="rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:shadow-md shadow-sm"
                      >
                        ✨ Find times
                      </button>
                      <button
                        onClick={() => setAddMemberGroupId(addMemberGroupId === group.id ? null : group.id)}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all ${
                          addMemberGroupId === group.id
                            ? 'border-purple-300 bg-purple-100 text-purple-700'
                            : 'border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-200'
                        }`}
                        title="Add a friend to this group"
                      >
                        +
                      </button>
                      <button
                        onClick={() => setDeletingGroup({ id: group.id, name: group.name })}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:border-red-200 transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Show non-friend group members with "Add friend" option */}
                  {nonFriendMembers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-purple-100/50">
                      <p className="text-[10px] text-gray-400 mb-1.5">Not yet connected:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {nonFriendMembers.map(m => {
                          const requested = groupFriendRequested.has(m.id);
                          const requesting = groupFriendRequesting.has(m.id);
                          return (
                            <button
                              key={m.id}
                              onClick={() => !requested && !requesting && handleGroupMemberFriendRequest(m.id)}
                              disabled={requested || requesting}
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                                requested
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50 hover:border-purple-300'
                              }`}
                            >
                              {m.photoUrl ? (
                                <img src={m.photoUrl} alt="" className="h-4 w-4 rounded-full" loading="lazy" />
                              ) : (
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-fuchsia-500 text-[8px] font-bold text-white">
                                  {m.displayName?.[0] ?? '?'}
                                </span>
                              )}
                              {m.displayName.split(' ')[0]}
                              {requesting ? ' …' : requested ? ' ✓ Sent' : ' + Add'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Add member to group panel */}
                  {addMemberGroupId === group.id && (() => {
                    const memberIds = new Set(group.members.map(m => m.id));
                    const addableFriends = acceptedFriends.filter(f => !memberIds.has(f.friend.id));
                    return (
                      <div className="mt-2 pt-2 border-t border-purple-100/50">
                        <p className="text-[10px] font-semibold text-gray-500 mb-2">Add a friend to this group:</p>
                        {addableFriends.length === 0 ? (
                          <p className="text-[11px] text-gray-400">All your friends are already in this group!</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {addableFriends.map(f => {
                              const adding = addingMemberIds.has(f.friend.id);
                              const added = addedMemberIds.has(f.friend.id);
                              return (
                                <button
                                  key={f.friend.id}
                                  onClick={() => !adding && !added && handleAddMemberToGroup(group.id, f.friend.id)}
                                  disabled={adding || added}
                                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all disabled:opacity-70 ${
                                    added
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : 'border-purple-200 bg-white text-purple-700 hover:bg-purple-50 hover:border-purple-300'
                                  }`}
                                >
                                  {f.friend.photoUrl ? (
                                    <img src={f.friend.photoUrl} alt="" className="h-4 w-4 rounded-full" loading="lazy" />
                                  ) : (
                                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-fuchsia-500 text-[8px] font-bold text-white">
                                      {f.friend.displayName?.[0] ?? '?'}
                                    </span>
                                  )}
                                  {f.friend.displayName.split(' ')[0]}
                                  {adding ? ' …' : added ? ' ✓' : ' +'}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}

        {groups.length === 0 && !showCreateGroup && (
          <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/20 p-5 mb-3">
            <div className="flex flex-col items-center text-center">
              <span className="text-2xl mb-1">👯</span>
              <p className="text-sm font-medium text-gray-600">No groups yet</p>
              <p className="mt-1 text-xs text-gray-400 max-w-xs">
                Create a group to find times when multiple friends are free — like brunch crews, game nights, or study buddies.
              </p>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="mt-3 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                + Create your first group
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreateGroup && (
        <div className="mb-6 rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">New Group</h3>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name (e.g. Brunch Crew, Book Club)"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 mb-3"
          />
          <p className="text-xs font-medium text-gray-500 mb-2">Select members:</p>
          <div className="space-y-1.5 mb-4 max-h-48 overflow-y-auto">
            {acceptedFriends.map(f => (
              <label key={f.friend.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-purple-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={createGroupSelectedIds.has(f.friend.id)}
                  onChange={() => toggleCreateGroupFriend(f.friend.id)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-500 focus:ring-purple-400"
                />
                {f.friend.photoUrl ? (
                  <img src={f.friend.photoUrl} alt="" className="h-7 w-7 rounded-full" loading="lazy" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[10px] font-semibold text-white">
                    {f.friend.displayName?.[0] ?? '?'}
                  </div>
                )}
                <span className="text-sm text-gray-700">{f.friend.displayName}</span>
              </label>
            ))}
          </div>
          {/* Invite friends not on Slotted.ai */}
          <div className="mt-4 mb-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Friends not on Slotted.ai yet? Invite by email:</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmailInput}
                onChange={(e) => setInviteEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddInviteEmail(); } }}
                placeholder="friend@email.com"
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
              />
              <button
                onClick={handleAddInviteEmail}
                type="button"
                className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-600 hover:bg-purple-100 transition-all"
              >
                + Add
              </button>
            </div>
            {invitedEmails.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {invitedEmails.map(email => (
                  <span key={email} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-medium text-amber-700">
                    ✉️ {email}
                    <button
                      onClick={() => handleRemoveInviteEmail(email)}
                      className="ml-0.5 text-amber-400 hover:text-red-500 transition-colors"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {invitedEmails.length > 0 && (
              <p className="mt-1.5 text-[10px] text-gray-400">
                These friends will receive an invite to join Slotted.ai and will be added to the group once they sign up.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateGroup}
              disabled={creatingGroup || !newGroupName.trim() || (createGroupSelectedIds.size + invitedEmails.length) < 2}
              className="rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingGroup ? 'Creating...' : 'Create Group'}
            </button>
            <button
              onClick={() => { setShowCreateGroup(false); setCreateGroupSelectedIds(new Set()); setNewGroupName(''); setInvitedEmails([]); setInviteEmailInput(''); }}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Incoming invites */}
      {incomingInvites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Friend Requests</h2>
          <div className="overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/30 shadow-sm">
            {incomingInvites.map((f, i) => (
              <div
                key={f.friendshipId}
                className={`flex items-center justify-between gap-3 px-4 py-4 ${
                  i !== incomingInvites.length - 1 ? 'border-b border-amber-100' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {f.friend.photoUrl ? (
                    <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-amber-100" loading="lazy" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-semibold text-white">
                      {f.friend.displayName?.[0] ?? '?'}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{f.friend.displayName}</p>
                    <p className="text-xs text-gray-400">{f.friend.email}</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleFriendAction(f.friendshipId, 'accept')}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-emerald-600 shadow-sm"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleFriendAction(f.friendshipId, 'decline')}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outgoing invites */}
      {outgoingInvites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Pending Invites</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {outgoingInvites.map((f, i) => (
              <div
                key={f.friendshipId}
                className={`flex items-center justify-between gap-3 px-4 py-4 ${
                  i !== outgoingInvites.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {f.friend.photoUrl ? (
                    <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-gray-100" loading="lazy" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-500 text-sm font-semibold text-white">
                      {f.friend.displayName?.[0] ?? '?'}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{f.friend.displayName}</p>
                    <p className="text-xs text-gray-400">{f.friend.email}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accepted friends */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-400 border-t-transparent" />
        </div>
      ) : acceptedFriends.length === 0 && incomingInvites.length === 0 && outgoingInvites.length === 0 ? (
        <div className="rounded-2xl border border-slotted-200/60 bg-gradient-to-br from-slotted-50/60 to-purple-50/40 shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <div className="text-4xl sm:text-5xl mb-2">🤝</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              Ready to connect?
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-500 leading-relaxed">
              Share your invite link and Slotted.ai will find the best times for you to hang out together.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={handleText} className="flex items-center gap-2 rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                📱 Text a friend
              </button>
              <button onClick={handleCopy} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300">
                {copied ? '✅ Copied!' : '📋 Copy invite link'}
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-400">Or enter an email above to send a direct invite</p>
          </div>
        </div>
      ) : (
        <>
          {/* Local friends section */}
          {localFriends.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                📍 Local · {localFriends.length}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                {localFriends.map((f, i) => renderFriendCard(f, i, localFriends))}
              </div>
            </div>
          )}

          {/* Long-distance friends section — always visible */}
          <div className="mb-6">
            <div className="mb-3 flex items-center">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Long Distance {longDistanceFriends.length > 0 ? `· ${longDistanceFriends.length}` : ''}
              </h2>
              <button
                onClick={() => setShowAddLongDistancePicker((prev) => !prev)}
                disabled={localFriends.length === 0}
                title="Add a friend to Long Distance mode for optimized call/video call times"
                className={`ml-2 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all ${
                  showAddLongDistancePicker
                    ? 'border-purple-300 bg-purple-100 text-purple-700'
                    : 'border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-200'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                +
              </button>
            </div>

            {showAddLongDistancePicker && localFriends.length > 0 && (
              <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                <p className="mb-2 text-[11px] font-medium text-gray-600">Move a friend to Long Distance mode:</p>
                <div className="flex flex-wrap gap-2">
                  {localFriends.map((friend) => (
                      <button
                        key={friend.friendshipId}
                        onClick={async () => {
                          const success = await handleToggleFriendshipType(friend, 'long_distance');
                          if (success) setShowAddLongDistancePicker(false);
                        }}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:border-blue-300 hover:text-blue-700"
                      >
                      + {friend.friend.displayName.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {longDistanceFriends.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                {longDistanceFriends.map((f, i) => renderFriendCard(f, i, longDistanceFriends))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/20 p-5">
                <div className="flex flex-col items-center text-center">
                  <span className="text-2xl mb-1">🌎</span>
                  <p className="text-sm font-medium text-gray-600">No long-distance friends yet</p>
                  <p className="mt-1 text-xs text-gray-400 max-w-xs">
                    Friends in different cities or time zones will appear here automatically based on location, or you can change a friend's type in settings.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
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
                Are you sure you want to remove <span className="font-medium text-gray-700">{removingFriend.friend.displayName}</span>? You won't be able to see each other's availability anymore.
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

      {/* Delete group confirmation modal */}
      {deletingGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => !deleteGroupLoading && setDeletingGroup(null)}
        >
          <div className="w-full max-w-[calc(100vw-1.5rem)] sm:max-w-sm rounded-2xl bg-white px-4 py-5 sm:p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete group?</h3>
              <p className="mt-2 text-sm text-gray-500">
                Are you sure you want to delete <span className="font-medium text-gray-700">{deletingGroup.name}</span>?
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setDeletingGroup(null)}
                disabled={deleteGroupLoading}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteGroup(deletingGroup.id)}
                disabled={deleteGroupLoading}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleteGroupLoading ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
