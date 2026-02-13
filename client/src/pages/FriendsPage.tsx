import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';

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

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

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

  // invitedBy === friend.id means THEY invited ME (incoming)
  // invitedBy !== friend.id means I invited THEM (outgoing)
  const incomingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy === f.friend.id
  );
  const outgoingInvites = friends.filter(
    (f) => f.status === 'pending' && f.invitedBy !== f.friend.id
  );
  const acceptedFriends = friends.filter((f) => f.status === 'accepted');

  const batteryEmoji = (battery?: string) => {
    if (battery === 'open') return '\u{1F7E2}';
    if (battery === 'ask_me') return '\u{1F7E1}';
    if (battery === 'recharging') return '\u{1F534}';
    return '';
  };

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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
            Friends {'\u00B7'} {acceptedFriends.length}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {acceptedFriends.map((f, i) => (
              <div
                key={f.friendshipId}
                className={`flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50 ${
                  i !== acceptedFriends.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-center gap-3">
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
                    <p className="text-xs text-gray-400">{f.friend.email}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Connected
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
