import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

interface GroupMember {
  id: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

interface FriendGroup {
  id: string;
  name: string;
  emoji: string;
  created_by: string;
  members: GroupMember[];
}

interface FriendRecord {
  friendshipId: string;
  status: string;
  invitedBy: string;
  friendshipType?: string;
  friend: {
    id: string;
    displayName: string;
    email: string;
    photoUrl?: string;
    socialBattery?: string;
    neighborhood?: string;
    timezone?: string;
  };
}

export default function FriendsPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('👥');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // Friendship type update handler
  const updateFriendshipType = async (friendshipId: string, type: string) => {
    try {
      await api.patch(`/friends/${friendshipId}`, { friendshipType: type });
      setFriends((prev) =>
        prev.map((f) => f.friendshipId === friendshipId ? { ...f, friendshipType: type } : f)
      );
    } catch { /* silent */ }
  };

  // Helper: get friend's local time
  const getFriendTime = (tz?: string) => {
    if (!tz) return null;
    try {
      return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    } catch { return null; }
  };

  const inviteUrl = inviteCode
    ? `https://slotted-ai.web.app/invite/${inviteCode}`
    : `https://slotted-ai.web.app?ref=${user?.uid ?? ''}`;
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
      const { data } = await api.get('/groups');
      setGroups(data.groups || []);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    fetchFriends();
    fetchGroups();
  }, [fetchFriends, fetchGroups]);

  // Fetch user's invite code
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.invite_code) setInviteCode(data.invite_code);
        }
      } catch {
        // fall back to UID-based URL
      }
    })();
  }, [user]);

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
      } else if (res.status === 202 || res.status === 404) {
        setInviteStatus({ type: 'success', message: `Invite saved! ${inviteEmail} will be auto-connected when they join. Share the invite link below to get them on Slotted.` });
        setInviteEmail('');
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || newGroupMemberIds.size === 0) return;
    setCreatingGroup(true);
    try {
      await api.post('/groups', {
        name: newGroupName.trim(),
        emoji: newGroupEmoji,
        memberIds: Array.from(newGroupMemberIds),
      });
      setNewGroupName('');
      setNewGroupEmoji('👥');
      setNewGroupMemberIds(new Set());
      setShowCreateGroup(false);
      fetchGroups();
    } catch {
      // silent
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await api.delete(`/groups/${groupId}`);
      setActiveGroupId(null);
      fetchGroups();
    } catch {
      // silent
    }
  };

  const toggleFriendSelect = (friendId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
    // Close single-friend panel when toggling selection
    setSelectedFriendId(null);
    setShowGroupPanel(false);
  };

  const clearSelection = () => {
    setSelectedGroupIds(new Set());
    setShowGroupPanel(false);
    setSelectedFriendId(null);
  };

  // invitedBy === friend.id means THEY invited ME (incoming)
  // invitedBy !== friend.id means I invited THEM (outgoing)
  const incomingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy === f.friend.id
  );
  const outgoingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy !== f.friend.id
  );
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');



  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Friends</h1>
      </div>

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
          Share invite link {'\u{1F4E8}'}
        </button>
        {showShareMenu && (
          <div className="absolute left-0 mt-2 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg z-20">
            <button onClick={handleText} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">{'\u{1F4F1}'}</span> Text message
            </button>
            <button onClick={handleEmail} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">{'\u{1F4E7}'}</span> Email
            </button>
            <button onClick={handleCopy} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <span className="text-base">{copied ? '\u2705' : '\u{1F4CB}'}</span> {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
      </div>

      {/* Groups */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Groups {groups.length > 0 ? `\u00B7 ${groups.length}` : ''}
          </h2>
          {acceptedFriends.length >= 2 && (
            <button
              onClick={() => setShowCreateGroup(!showCreateGroup)}
              className="text-xs font-semibold text-purple-600 hover:text-purple-700 transition-colors"
            >
              {showCreateGroup ? 'Cancel' : '+ New group'}
            </button>
          )}
        </div>

        {/* Empty state when not enough friends */}
        {acceptedFriends.length < 2 && groups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-5">
            <div className="flex flex-col items-center text-center">
              <span className="text-2xl mb-2">👥</span>
              <p className="text-sm font-medium text-gray-600">Group scheduling</p>
              <p className="mt-1 text-xs text-gray-400 max-w-xs">
                Once you have 2+ friends on Slotted, you can create groups to find times when everyone is free. Groups support up to 8 people.
              </p>
            </div>
          </div>
        )}

          {/* Create group form */}
          {showCreateGroup && (
            <div className="mb-4 rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/40 to-slotted-50/30 p-4 shadow-sm">
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newGroupEmoji}
                  onChange={(e) => setNewGroupEmoji(e.target.value)}
                  className="w-12 rounded-lg border border-gray-200 bg-white px-2 py-2 text-center text-lg shadow-sm focus:border-purple-300 focus:outline-none"
                  maxLength={2}
                />
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Group name (e.g. Brunch crew)"
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-300 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-gray-400 mb-2">Select members:</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {acceptedFriends.map((f) => (
                  <button
                    key={f.friend.id}
                    onClick={() => {
                      setNewGroupMemberIds((prev) => {
                        const next = new Set(prev);
                        next.has(f.friend.id) ? next.delete(f.friend.id) : next.add(f.friend.id);
                        return next;
                      });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                      newGroupMemberIds.has(f.friend.id)
                        ? 'border-purple-400 bg-purple-100 text-purple-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'
                    }`}
                  >
                    {newGroupMemberIds.has(f.friend.id) ? '✓ ' : ''}{f.friend.displayName}
                  </button>
                ))}
              </div>
              <button
                onClick={handleCreateGroup}
                disabled={creatingGroup || !newGroupName.trim() || newGroupMemberIds.size === 0}
                className="rounded-xl bg-gradient-to-r from-purple-500 to-slotted-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
              >
                {creatingGroup ? 'Creating...' : `Create group (${newGroupMemberIds.size} members)`}
              </button>
            </div>
          )}

          {/* Group cards */}
          {groups.length > 0 && (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{g.emoji}</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {g.members.map((m) => m.displayName).join(', ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveGroupId(activeGroupId === g.id ? null : g.id)}
                        className={`rounded-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                          activeGroupId === g.id
                            ? 'bg-gray-200 text-gray-700'
                            : 'bg-gradient-to-r from-purple-500 to-slotted-500 text-white'
                        }`}
                      >
                        {activeGroupId === g.id ? 'Close' : '👥 Find times'}
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(g.id)}
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:text-red-500 hover:border-red-200 transition-all"
                        title="Delete group"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expandable group availability */}
                  {activeGroupId === g.id && (
                    <div className="px-5 pb-5 border-t border-gray-100">
                      <GroupAvailability
                        friendIds={g.members.filter((m) => m.id !== g.created_by).map((m) => m.id)}
                        friendNames={g.members.filter((m) => m.id !== g.created_by).map((m) => m.displayName)}
                        onClose={() => setActiveGroupId(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

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
            <div className="text-5xl mb-2">{'\u{1F91D}'}</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              No friends yet
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Invite a friend by email or share your link above.
            </p>
          </div>
        </div>
      ) : acceptedFriends.length > 0 ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Friends {'\u00B7'} {acceptedFriends.length}
            </h2>
            <p className="text-[11px] text-gray-400">
              {selectedGroupIds.size === 0 ? 'Tap to select friends' : ''}
            </p>
          </div>

          {/* Inline availability panels */}
          {showGroupPanel && selectedGroupIds.size >= 2 && (
            <div className="mb-4">
              <GroupAvailability
                friendIds={Array.from(selectedGroupIds)}
                friendNames={acceptedFriends
                  .filter((f) => selectedGroupIds.has(f.friend.id))
                  .map((f) => f.friend.displayName || 'Friend')}
                onClose={clearSelection}
              />
            </div>
          )}
          {selectedFriendId && selectedGroupIds.size === 1 && (
            <div className="mb-4">
              <FriendAvailability
                friendId={selectedFriendId}
                friendName={acceptedFriends.find((f) => f.friend.id === selectedFriendId)?.friend.displayName || 'Friend'}
                onClose={clearSelection}
              />
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {acceptedFriends.map((f, i) => {
              const isSelected = selectedGroupIds.has(f.friend.id);
              const friendTime = getFriendTime(f.friend.timezone);
              const fType = f.friendshipType || 'local';
              const isLongDistance = fType === 'long_distance' || fType === 'both';
              return (
                <div key={f.friendshipId}>
                  <button
                    onClick={() => toggleFriendSelect(f.friend.id)}
                    className={`flex w-full items-center justify-between px-5 py-4 text-left transition-all ${
                      isSelected
                        ? 'bg-slotted-50/40'
                        : 'hover:bg-gray-50/50'
                    } ${
                      i !== acceptedFriends.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Selection indicator */}
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                          isSelected
                            ? 'border-slotted-500 bg-slotted-500 text-white scale-110'
                            : 'border-gray-300'
                        }`}
                      >
                        {isSelected && (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
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
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-gray-400">{f.friend.email}</p>
                          {isLongDistance && friendTime && (
                            <span className="text-[10px] text-gray-400">🕐 {friendTime}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Friendship type toggle */}
                      <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5" onClick={(e) => e.stopPropagation()}>
                        {([
                          { value: 'local', emoji: '📍', tip: 'Local' },
                          { value: 'long_distance', emoji: '📞', tip: 'Long distance' },
                          { value: 'both', emoji: '🌐', tip: 'Both' },
                        ] as const).map((opt) => (
                          <button
                            key={opt.value}
                            title={opt.tip}
                            onClick={(e) => { e.stopPropagation(); updateFriendshipType(f.friendshipId, opt.value); }}
                            className={`rounded px-1.5 py-0.5 text-[10px] transition-all ${
                              fType === opt.value
                                ? 'bg-white text-gray-800 shadow-sm font-semibold'
                                : 'text-gray-400 hover:text-gray-600'
                            }`}
                          >
                            {opt.emoji}
                          </button>
                        ))}
                      </div>
                      {isLongDistance && f.friend.neighborhood && (
                        <span className="text-[10px] text-gray-400 max-w-[80px] truncate">{f.friend.neighborhood}</span>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* ─── Floating action bar ─── */}
      {selectedGroupIds.size > 0 && !showGroupPanel && !(selectedFriendId && selectedGroupIds.size === 1) && (
        <div className="fixed bottom-20 inset-x-0 z-50 flex justify-center px-4 md:bottom-6 animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/95 px-5 py-3 shadow-xl backdrop-blur-xl">
            {/* Selected avatars */}
            <div className="flex -space-x-2">
              {acceptedFriends
                .filter((f) => selectedGroupIds.has(f.friend.id))
                .slice(0, 4)
                .map((f) =>
                  f.friend.photoUrl ? (
                    <img key={f.friend.id} src={f.friend.photoUrl} alt="" className="h-8 w-8 rounded-full ring-2 ring-white" />
                  ) : (
                    <div key={f.friend.id} className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-xs font-semibold text-white ring-2 ring-white">
                      {f.friend.displayName?.[0] ?? '?'}
                    </div>
                  ),
                )}
              {selectedGroupIds.size > 4 && (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 ring-2 ring-white">
                  +{selectedGroupIds.size - 4}
                </div>
              )}
            </div>

            <div className="text-xs text-gray-500">
              {selectedGroupIds.size === 1
                ? acceptedFriends.find((f) => selectedGroupIds.has(f.friend.id))?.friend.displayName
                : `${selectedGroupIds.size} friends`}
            </div>

            {/* CTA — adapts to 1 vs 2+ */}
            {selectedGroupIds.size === 1 ? (
              <button
                onClick={() => {
                  const friendId = Array.from(selectedGroupIds)[0];
                  setSelectedFriendId(friendId);
                }}
                className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                ✨ Find 1:1 times
              </button>
            ) : (
              <button
                onClick={() => { setShowGroupPanel(true); setSelectedFriendId(null); }}
                className="rounded-xl bg-gradient-to-r from-purple-500 to-slotted-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                👥 Find group times
              </button>
            )}

            {/* Clear */}
            <button
              onClick={clearSelection}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
