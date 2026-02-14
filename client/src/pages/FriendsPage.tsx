import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';

interface FriendRecord {
  friendshipId: string;
  status: string;
  invitedBy: string;
  friend: {
    id: string;
    displayName: string;
    email: string;
    photoUrl?: string;
    socialBattery?: string;
    calendarConnected?: boolean;
  };
}

interface SavedGroup {
  id: string;
  name: string;
  members: { userId: string; displayName: string; photoUrl?: string }[];
}

export default function FriendsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Find times state
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string>('');

  // Group scheduling state
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [checkedFriendIds, setCheckedFriendIds] = useState<Set<string>>(new Set());
  const [showGroupAvailability, setShowGroupAvailability] = useState(false);

  // Saved groups
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  const inviteUrl = `https://slotted-ai.web.app?ref=${user?.uid ?? ''}`;
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

  const fetchFriends = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/friends', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (err) {
      console.error('Failed to fetch friends:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    fetchFriends();
    fetchGroups();
  }, [fetchFriends, fetchGroups]);

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

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !user) return;
    setInviting(true);
    setInviteStatus(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/friends/invite', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteStatus({ type: 'success', message: `Invite sent to ${inviteEmail}!` });
        setInviteEmail('');
        fetchFriends();
      } else if (res.status === 404) {
        setInviteStatus({ type: 'info', message: `${inviteEmail} isn't on Slotted yet — share the invite link below!` });
      } else {
        setInviteStatus({ type: 'error', message: data.error || 'Something went wrong' });
      }
    } catch {
      setInviteStatus({ type: 'error', message: 'Network error — please try again' });
    } finally {
      setInviting(false);
    }
  };

  const handleFriendAction = async (friendshipId: string, action: 'accept' | 'decline') => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch(`/api/friends/${friendshipId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
      fetchFriends();
    } catch (err) {
      console.error('Failed to update friendship:', err);
    }
  };

  const handleText = () => {
    window.open(`sms:?&body=${encodeURIComponent(message)}`, '_blank');
    setShowShareMenu(false);
  };

  const handleEmail = () => {
    window.open(
      `mailto:?subject=${encodeURIComponent("Let's hang — try Slotted!")}&body=${encodeURIComponent(message)}`,
      '_blank'
    );
    setShowShareMenu(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => { setCopied(false); setShowShareMenu(false); }, 1500);
  };

  const toggleCheckedFriend = (id: string) => {
    setCheckedFriendIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGroupScheduling = () => {
    if (checkedFriendIds.size < 1) return;
    setShowGroupAvailability(true);
    setSelectedFriendId(null);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || checkedFriendIds.size === 0 || !user) return;
    setCreatingGroup(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          memberIds: Array.from(checkedFriendIds),
        }),
      });
      if (res.ok) {
        setNewGroupName('');
        setShowCreateGroup(false);
        fetchGroups();
      }
    } catch {
      // silent
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroups();
    } catch {
      // silent
    }
  };

  const handleGroupFindTimes = (group: SavedGroup) => {
    const ids = group.members.map(m => m.userId);
    setCheckedFriendIds(new Set(ids));
    setMultiSelectMode(true);
    setShowGroupAvailability(true);
    setSelectedFriendId(null);
  };

  const incomingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy === f.friend.id
  );
  const outgoingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy !== f.friend.id
  );
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');

  const checkedFriendNames = acceptedFriends
    .filter(f => checkedFriendIds.has(f.friend.id))
    .map(f => f.friend.displayName);

  const batteryEmoji = (battery?: string) => {
    if (battery === 'open') return '🟢';
    if (battery === 'ask_me') return '🟡';
    if (battery === 'recharging') return '🔴';
    return '';
  };

  return (
    <AppShell>
      <div className="mb-8">
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
      {showGroupAvailability && checkedFriendIds.size > 0 && (
        <div className="mb-6">
          <GroupAvailability
            friendIds={Array.from(checkedFriendIds)}
            friendNames={checkedFriendNames}
            onClose={() => { setShowGroupAvailability(false); setMultiSelectMode(false); setCheckedFriendIds(new Set()); }}
          />
        </div>
      )}

      {/* Invite by email */}
      <div className="mb-6">
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            placeholder="Enter a friend's email..."
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
          />
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {inviting ? 'Sending...' : 'Invite'}
          </button>
        </div>
        {inviteStatus && (
          <div className={`mt-2 rounded-xl border px-4 py-2.5 text-xs ${
            inviteStatus.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
            inviteStatus.type === 'info' ? 'border-amber-200 bg-amber-50 text-amber-700' :
            'border-red-200 bg-red-50 text-red-700'
          }`}>
            {inviteStatus.message}
          </div>
        )}
      </div>

      {/* Share invite link */}
      <div className="relative mb-8">
        <button
          onClick={() => setShowShareMenu(!showShareMenu)}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300"
        >
          Share invite link 📨
        </button>
        {showShareMenu && (
          <div className="absolute left-0 mt-2 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg z-20">
            <button onClick={handleText} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">📱</span> Text message
            </button>
            <button onClick={handleEmail} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">📧</span> Email
            </button>
            <button onClick={handleCopy} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">{copied ? '✅' : '📋'}</span> {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          For friends not yet on Slotted — send them a link to sign up
        </p>
      </div>

      {/* Saved Groups */}
      {groups.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Saved Groups</h2>
          <div className="space-y-2">
            {groups.map(group => (
              <div key={group.id} className="flex items-center justify-between rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/30 to-fuchsia-50/20 px-5 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="text-lg">👥</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{group.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {group.members.map(m => m.displayName.split(' ')[0]).join(', ')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGroupFindTimes(group)}
                    className="rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:shadow-md shadow-sm"
                  >
                    ✨ Find times
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id)}
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 hover:border-red-200 transition-all"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
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
                className={`flex items-center justify-between px-5 py-4 ${
                  i !== incomingInvites.length - 1 ? 'border-b border-amber-100' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {f.friend.photoUrl ? (
                    <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-amber-100" />
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
                <div className="flex gap-2">
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
                className={`flex items-center justify-between px-5 py-4 ${
                  i !== outgoingInvites.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {f.friend.photoUrl ? (
                    <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-gray-100" />
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

      {/* Accepted friends list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-400 border-t-transparent" />
        </div>
      ) : acceptedFriends.length === 0 && incomingInvites.length === 0 && outgoingInvites.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <div className="text-5xl mb-2">🤝</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              No friends yet — but soon!
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Enter their email above to send an invite. Once they accept,
              you'll see their availability and Slotted will start suggesting times to meet.
            </p>
          </div>
        </div>
      ) : acceptedFriends.length > 0 ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Friends · {acceptedFriends.length}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setMultiSelectMode(!multiSelectMode); if (multiSelectMode) { setCheckedFriendIds(new Set()); setShowGroupAvailability(false); } }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  multiSelectMode
                    ? 'border-purple-300 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {multiSelectMode ? '✕ Cancel' : '👥 Group scheduling'}
              </button>
            </div>
          </div>

          {/* Multi-select action bar */}
          {multiSelectMode && checkedFriendIds.size > 0 && !showGroupAvailability && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50/50 px-4 py-2.5">
              <span className="text-xs font-medium text-purple-700">
                {checkedFriendIds.size} selected
              </span>
              <div className="flex-1" />
              <button
                onClick={() => setShowCreateGroup(true)}
                className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-all"
              >
                💾 Save Group
              </button>
              <button
                onClick={handleGroupScheduling}
                className="rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md"
              >
                ✨ Find group times
              </button>
            </div>
          )}

          {/* Create group modal */}
          {showCreateGroup && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-2.5 shadow-sm">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                placeholder="Group name (e.g. Book Club)"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-200"
              />
              <button
                onClick={handleCreateGroup}
                disabled={creatingGroup || !newGroupName.trim()}
                className="rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {creatingGroup ? '...' : 'Create'}
              </button>
              <button
                onClick={() => setShowCreateGroup(false)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {acceptedFriends.map((f, i) => (
              <div
                key={f.friendshipId}
                className={`flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50 ${
                  i !== acceptedFriends.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Multi-select checkbox */}
                  {multiSelectMode && (
                    <input
                      type="checkbox"
                      checked={checkedFriendIds.has(f.friend.id)}
                      onChange={() => toggleCheckedFriend(f.friend.id)}
                      className="h-4 w-4 rounded border-gray-300 text-purple-500 focus:ring-purple-400"
                    />
                  )}
                  {f.friend.photoUrl ? (
                    <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white">
                      {f.friend.displayName?.[0] ?? '?'}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {f.friend.displayName}
                      {f.friend.socialBattery && (
                        <span className="ml-1.5">{batteryEmoji(f.friend.socialBattery)}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400">{f.friend.email}</p>
                      {/* Calendar connection badge */}
                      {f.friend.calendarConnected !== undefined && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                          f.friend.calendarConnected
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                            : 'bg-gray-50 text-gray-400 border border-gray-200'
                        }`}>
                          {f.friend.calendarConnected ? '📅' : '—'} {f.friend.calendarConnected ? 'Cal' : 'No cal'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!multiSelectMode && (
                    <button
                      onClick={() => handleFindTimes(f.friend.id, f.friend.displayName)}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                        selectedFriendId === f.friend.id
                          ? 'bg-slotted-500 text-white'
                          : 'gradient-btn text-white'
                      }`}
                    >
                      {selectedFriendId === f.friend.id ? '✨ Viewing' : '✨ Find times'}
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
