import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import FriendAvailability from '../components/FriendAvailability';
import GroupAvailability from '../components/GroupAvailability';
import api from '../lib/api';

interface FriendRecord {
  friendshipId: string;
  status: string;
  invitedBy: string;
  friendshipType?: string; // "local" | "long_distance"
  lastHangoutDate?: string;
  daysSinceLastHangout?: number;
  avgCadenceDays?: number;
  totalHangouts?: number;
  friend: {
    id: string;
    displayName: string;
    email: string;
    photoUrl?: string;
    socialBattery?: string;
    calendarConnected?: boolean;
    eventInterests?: string[];
  };
}

const INTEREST_LABELS: Record<string, { emoji: string; label: string }> = {
  theater: { emoji: '🎭', label: 'Theater' },
  concerts: { emoji: '🎵', label: 'Concerts' },
  sports: { emoji: '⚽', label: 'Sports' },
  comedy: { emoji: '😂', label: 'Comedy' },
  festivals: { emoji: '🎪', label: 'Festivals' },
  dance: { emoji: '💃', label: 'Dance' },
  opera: { emoji: '🎻', label: 'Classical' },
};

interface SavedGroup {
  id: string;
  name: string;
  members: { id: string; displayName: string; photoUrl?: string }[];
  pendingEmails?: string[];
}

/** Collapsible "How it works" explainer */
function HowItWorks() {
  const [open, setOpen] = useState(false);

  const steps = [
    { emoji: '1️⃣', title: 'Invite a friend', desc: 'Share your invite link via text, email, or copy link. They\'ll get a friend request when they sign up.' },
    { emoji: '2️⃣', title: 'Connect calendars', desc: 'Both you and your friend connect a Google or Apple calendar in Settings so Slotted can find free times.' },
    { emoji: '3️⃣', title: 'Find times', desc: 'Tap "Find times" on a friend — then choose In Person, Phone Call, or Video Call. Slotted finds the best slots for each type (calls can be shorter and skip travel time).' },
    { emoji: '4️⃣', title: 'Book it', desc: 'Pick a time and hit "Book it." Your friend gets a notification in their inbox to accept or decline.' },
    { emoji: '5️⃣', title: 'Add to calendar', desc: 'After booking (or accepting), you\'ll both be prompted to save the event to a specific Google or Apple calendar.' },
  ];

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-2xl border border-slotted-100 bg-gradient-to-r from-slotted-50/40 to-purple-50/30 px-5 py-3 text-left transition-all hover:shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">💡</span>
          <span className="text-sm font-semibold text-gray-800">How Slotted works</span>
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
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-lg flex-shrink-0 mt-0.5">{s.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{s.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 mt-2">
            <p className="text-[11px] text-amber-700 leading-relaxed">
              <span className="font-semibold">Tip:</span> Ask your friends to connect their calendar too — Slotted works best when both sides are synced!
            </p>
          </div>
          <div className="rounded-xl bg-slotted-50 border border-slotted-200 px-4 py-2.5">
            <p className="text-[11px] text-slotted-700 leading-relaxed">
              <span className="font-semibold">📲 Install the app:</span> Add Slotted to your home screen for the best experience. Go to{' '}
              <a href="/settings" className="underline font-medium hover:text-slotted-800">Settings</a>{' '}
              to see install instructions for your device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FriendsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Find times state
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedFriendName, setSelectedFriendName] = useState<string>('');

  // Group availability state
  const [showGroupAvailability, setShowGroupAvailability] = useState(false);
  const [groupFriendIds, setGroupFriendIds] = useState<string[]>([]);
  const [groupFriendNames, setGroupFriendNames] = useState<string[]>([]);

  // Saved groups
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [createGroupSelectedIds, setCreateGroupSelectedIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [invitedEmails, setInvitedEmails] = useState<string[]>([]);
  const [inviteEmailInput, setInviteEmailInput] = useState('');
  const [myEventInterests, setMyEventInterests] = useState<string[]>([]);

  // Remove friend state
  const [removingFriend, setRemovingFriend] = useState<FriendRecord | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Add friend by email state
  const [addFriendEmail, setAddFriendEmail] = useState('');
  const [addFriendStatus, setAddFriendStatus] = useState<'idle' | 'sending' | 'sent' | 'pending' | 'error'>('idle');
  const [addFriendMessage, setAddFriendMessage] = useState('');

  const inviteUrl = `https://slotted-ai.web.app?ref=${user?.uid ?? ''}`;
  const message = `Let's schedule time to hang :) This app syncs our calendars and finds the best time to meet up. ${inviteUrl}`;

  // Load current user's event interests
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const me = await res.json();
          if (me.event_interests) setMyEventInterests(me.event_interests);
        }
      } catch { /* ignore */ }
    })();
  }, [user]);

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

  const handleAddFriendByEmail = async () => {
    const email = addFriendEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (acceptedFriends.some(f => f.friend.email.toLowerCase() === email)) {
      setAddFriendStatus('error');
      setAddFriendMessage('Already friends!');
      setTimeout(() => { setAddFriendStatus('idle'); setAddFriendMessage(''); }, 2000);
      return;
    }
    setAddFriendStatus('sending');
    try {
      const res = await api.post('/friends/invite', { email });
      if (res.data.pending) {
        setAddFriendStatus('pending');
        setAddFriendMessage(res.data.message || `${email} isn't on Slotted yet — they'll be connected when they join!`);
      } else {
        setAddFriendStatus('sent');
        setAddFriendMessage('Friend request sent!');
        fetchFriends();
      }
      setAddFriendEmail('');
      setTimeout(() => { setAddFriendStatus('idle'); setAddFriendMessage(''); }, 4000);
    } catch (err: any) {
      setAddFriendStatus('error');
      setAddFriendMessage(err?.response?.data?.error || 'Failed to send request');
      setTimeout(() => { setAddFriendStatus('idle'); setAddFriendMessage(''); }, 3000);
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

  const handleRemoveFriend = async () => {
    if (!user || !removingFriend) return;
    setRemoveLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/friends/${removingFriend.friendshipId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to remove friend');
      setRemovingFriend(null);
      fetchFriends();
    } catch (err) {
      console.error('Failed to remove friend:', err);
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleText = () => {
    window.open(`sms:?&body=${encodeURIComponent(message)}`, '_blank');
  };

  const handleEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent("Let's hang — try Slotted!")}&body=${encodeURIComponent(message)}`;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
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
    if (!newGroupName.trim() || (createGroupSelectedIds.size === 0 && invitedEmails.length === 0) || !user) return;
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
      const token = await user.getIdToken();
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          memberIds: Array.from(createGroupSelectedIds),
          invitedEmails: invitedEmails.length > 0 ? invitedEmails : undefined,
        }),
      });
      if (res.ok) {
        setNewGroupName('');
        setCreateGroupSelectedIds(new Set());
        setInvitedEmails([]);
        setInviteEmailInput('');
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
      className={`flex items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-gray-50/50 ${
        i !== arr.length - 1 ? 'border-b border-gray-100' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {f.friend.photoUrl ? (
          <img src={f.friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white">
            {f.friend.displayName?.[0] ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {f.friend.displayName}
            {f.friend.socialBattery && (
              <span className="ml-1.5 relative group cursor-default">
                {batteryEmoji(f.friend.socialBattery)}
                <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  {batteryLabel(f.friend.socialBattery)}
                </span>
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 truncate">
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
              <div className="mt-1 flex flex-wrap gap-1">
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
              <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight ${
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
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => handleFindTimes(f.friend.id, f.friend.displayName)}
          className={`rounded-xl px-3 py-2 text-xs font-semibold shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
            selectedFriendId === f.friend.id
              ? 'bg-slotted-500 text-white'
              : 'gradient-btn text-white'
          }`}
        >
          {selectedFriendId === f.friend.id ? '✨ Viewing' : '✨ Find times'}
        </button>
        <button
          onClick={() => setRemovingFriend(f)}
          className="rounded-lg p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          title="Remove friend"
        >
          🗑️
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

      {/* How it works — collapsible */}
      <HowItWorks />

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
        <p className="text-sm text-gray-500 mb-3">Invite friends to Slotted so you can find the best times to hang out.</p>
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

      {/* Add friend by email */}
      <div className="mb-8 rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">🔍</span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Add a friend</h3>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">
          Enter their email to send a friend request. If they're already on Slotted, they'll get a notification. If not, they'll be auto-connected when they join.
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            value={addFriendEmail}
            onChange={(e) => setAddFriendEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFriendByEmail(); } }}
            placeholder="friend@email.com"
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
          />
          <button
            onClick={handleAddFriendByEmail}
            disabled={addFriendStatus === 'sending' || !addFriendEmail.trim()}
            className="rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {addFriendStatus === 'sending' ? '...' : '+ Add'}
          </button>
        </div>
        {addFriendMessage && (
          <p className={`mt-2 text-xs font-medium ${
            addFriendStatus === 'sent' ? 'text-emerald-600'
              : addFriendStatus === 'pending' ? 'text-amber-600'
                : addFriendStatus === 'error' ? 'text-red-500'
                  : 'text-gray-500'
          }`}>
            {addFriendStatus === 'sent' && '✅ '}{addFriendStatus === 'pending' && '📩 '}{addFriendStatus === 'error' && '❌ '}{addFriendMessage}
          </p>
        )}
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
            {groups.map(group => (
              <div key={group.id} className="flex items-center justify-between gap-3 rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/30 to-fuchsia-50/20 px-4 py-3 shadow-sm">
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
                <div className="flex gap-2 shrink-0">
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
          <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
            {acceptedFriends.map(f => (
              <label key={f.friend.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-purple-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={createGroupSelectedIds.has(f.friend.id)}
                  onChange={() => toggleCreateGroupFriend(f.friend.id)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-500 focus:ring-purple-400"
                />
                {f.friend.photoUrl ? (
                  <img src={f.friend.photoUrl} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[10px] font-semibold text-white">
                    {f.friend.displayName?.[0] ?? '?'}
                  </div>
                )}
                <span className="text-sm text-gray-700">{f.friend.displayName}</span>
              </label>
            ))}
          </div>
          {/* Invite friends not on Slotted */}
          <div className="mt-4 mb-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Friends not on Slotted yet? Invite by email:</p>
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
                These friends will receive an invite to join Slotted and will be added to the group once they sign up.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateGroup}
              disabled={creatingGroup || !newGroupName.trim() || (createGroupSelectedIds.size === 0 && invitedEmails.length === 0)}
              className="rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50"
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

      {/* Accepted friends */}
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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              ✈️ Long Distance {longDistanceFriends.length > 0 ? `· ${longDistanceFriends.length}` : ''}
            </h2>
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
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
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
    </AppShell>
  );
}
