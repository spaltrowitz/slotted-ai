import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import type { FriendRecord } from '../lib/queries';
import { queryKeys } from '../lib/queries';

interface CoupleLink {
  id: string;
  status: 'pending' | 'accepted' | 'unlinked';
  display_name: string | null;
  invited_by: string;
  isInviter: boolean;
  partner: {
    id: string;
    displayName: string;
    photoUrl: string | null;
  };
  availabilitySlots: number;
}

interface CoupleModeProps {
  friends: FriendRecord[];
}

export default function CoupleMode({ friends }: CoupleModeProps) {
  const queryClient = useQueryClient();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [displayName, setDisplayName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['coupleLink'],
    queryFn: async () => {
      const res = await api.get('/couples/me');
      return res.data.coupleLink as CoupleLink | null;
    },
  });

  const linkMutation = useMutation({
    mutationFn: async ({ partnerId, displayName }: { partnerId: string; displayName?: string }) => {
      await api.post('/couples/link', { partnerId, displayName: displayName || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupleLink'] });
      setShowSearch(false);
      setSearchQuery('');
      setDisplayName('');
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ coupleId, action }: { coupleId: string; action: 'accept' | 'decline' | 'unlink' }) => {
      await api.patch(`/couples/${coupleId}`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupleLink'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (coupleId: string) => {
      await api.post(`/couples/${coupleId}/sync`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupleLink'] });
    },
  });

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const filteredFriends = acceptedFriends.filter((f) =>
    f.friend.displayName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-pink-50 animate-pulse" />
          <div className="h-4 w-32 rounded bg-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50">
          <span className="text-lg">💕</span>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">Couple Mode</p>
          <p className="text-xs text-gray-500">Link with your partner for combined scheduling</p>
        </div>
      </div>

      {/* No link — show action */}
      {!data && !showSearch && (
        <button
          onClick={() => setShowSearch(true)}
          className="w-full rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-2.5 text-sm font-medium text-white hover:from-pink-600 hover:to-rose-600 transition-all"
        >
          Link with partner
        </button>
      )}

      {/* Search friends to link */}
      {!data && showSearch && (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Search friends…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-pink-300 focus:ring-1 focus:ring-pink-200 outline-none"
            autoFocus
          />
          <input
            type="text"
            placeholder='Display name (e.g. "The Smiths")'
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-pink-300 focus:ring-1 focus:ring-pink-200 outline-none"
          />
          <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100">
            {filteredFriends.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No friends found</p>
            )}
            {filteredFriends.map((f) => (
              <button
                key={f.friend.id}
                onClick={() => linkMutation.mutate({ partnerId: f.friend.id, displayName })}
                disabled={linkMutation.isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-pink-50 transition-colors disabled:opacity-50"
              >
                {f.friend.photoUrl ? (
                  <img src={f.friend.photoUrl} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-[10px] font-semibold text-white">
                    {f.friend.displayName?.[0] ?? '?'}
                  </div>
                )}
                <span className="text-gray-700">{f.friend.displayName}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setShowSearch(false); setSearchQuery(''); }}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Pending — waiting for partner */}
      {data?.status === 'pending' && data.isInviter && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
          <p className="text-sm text-amber-800">
            Waiting for <span className="font-medium">{data.partner.displayName}</span> to accept
          </p>
        </div>
      )}

      {/* Pending — need to accept */}
      {data?.status === 'pending' && !data.isInviter && (
        <div className="space-y-3">
          <div className="rounded-xl bg-pink-50 border border-pink-100 p-3">
            <p className="text-sm text-pink-800">
              <span className="font-medium">{data.partner.displayName}</span> wants to link as a couple
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => actionMutation.mutate({ coupleId: data.id, action: 'accept' })}
              disabled={actionMutation.isPending}
              className="flex-1 rounded-xl bg-pink-500 px-3 py-2 text-sm font-medium text-white hover:bg-pink-600 transition-colors disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={() => actionMutation.mutate({ coupleId: data.id, action: 'decline' })}
              disabled={actionMutation.isPending}
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Accepted — show status */}
      {data?.status === 'accepted' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-pink-50/50 border border-pink-100/60 p-3">
            {data.partner.photoUrl ? (
              <img src={data.partner.photoUrl} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-xs font-semibold text-white">
                {data.partner.displayName?.[0] ?? '?'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {data.display_name || `You & ${data.partner.displayName}`}
              </p>
              <p className="text-xs text-gray-500">
                {data.availabilitySlots} shared free slot{data.availabilitySlots !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => syncMutation.mutate(data.id)}
              disabled={syncMutation.isPending}
              className="rounded-lg bg-white border border-gray-200 p-1.5 text-gray-400 hover:text-pink-500 transition-colors disabled:opacity-50"
              aria-label="Sync availability"
            >
              <svg className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => actionMutation.mutate({ coupleId: data.id, action: 'unlink' })}
            disabled={actionMutation.isPending}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-50"
          >
            Unlink
          </button>
        </div>
      )}

      {linkMutation.isError && (
        <p className="mt-2 text-xs text-red-500">
          {(linkMutation.error as any)?.response?.data?.error || 'Something went wrong'}
        </p>
      )}
    </div>
  );
}
