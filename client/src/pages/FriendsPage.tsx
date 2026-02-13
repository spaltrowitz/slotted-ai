import { useState } from 'react';
import AppShell from '../components/AppShell';
import SocialBattery from '../components/SocialBattery';

interface Friend {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  battery: 'open' | 'ask_me' | 'recharging';
}

export default function FriendsPage() {
  const [friends] = useState<Friend[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: call API to send friend invite
    console.log('Invite:', inviteEmail);
    setInviteEmail('');
  };

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">Friends</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your people. See who's around and feeling social 🫶
        </p>
      </div>

      {/* Invite form — warmer with gradient button */}
      <form onSubmit={handleInvite} className="mb-8 flex gap-3">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="friend@email.com"
          className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm placeholder:text-gray-300 focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
        />
        <button
          type="submit"
          className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
        >
          Invite ✉️
        </button>
      </form>

      {/* Friends list */}
      {friends.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <div className="animate-float text-5xl mb-2">🤝</div>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              No friends yet — but soon!
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Type their email above and we'll invite them to Slotted.
              Once they join, you'll see their availability and Social Battery here.
            </p>
            <div className="mt-8 flex items-center gap-6 rounded-2xl border border-slotted-50 bg-gradient-to-r from-slotted-50/50 to-purple-50/50 px-6 py-4">
              <div className="text-center">
                <p className="text-2xl">📅</p>
                <p className="mt-1 text-[10px] font-medium text-gray-400">See calendars</p>
              </div>
              <div className="h-8 w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-2xl">🔋</p>
                <p className="mt-1 text-[10px] font-medium text-gray-400">Check energy</p>
              </div>
              <div className="h-8 w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-2xl">✨</p>
                <p className="mt-1 text-[10px] font-medium text-gray-400">Auto-schedule</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          {friends.map((friend, i) => (
            <div
              key={friend.id}
              className={`flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50 ${
                i !== friends.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {friend.photoUrl ? (
                  <img src={friend.photoUrl} alt="" className="h-10 w-10 rounded-full ring-2 ring-slotted-100" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-sm font-semibold text-white">
                    {friend.name[0]}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">{friend.name}</p>
                  <p className="text-xs text-gray-400">{friend.email}</p>
                </div>
              </div>
              <SocialBattery level={friend.battery} readonly size="sm" />
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
