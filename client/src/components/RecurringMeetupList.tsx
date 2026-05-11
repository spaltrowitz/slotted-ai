import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import RecurringMeetupCard from './RecurringMeetupCard';
import type { FriendRecord } from '../lib/queries';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_PREFS = ['morning', 'afternoon', 'evening'] as const;

interface RecurringMeetupListProps {
  friends: FriendRecord[];
  preselectedFriendId?: string;
}

export default function RecurringMeetupList({ friends, preselectedFriendId }: RecurringMeetupListProps) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(!!preselectedFriendId);
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState('biweekly');
  const [preferredDay, setPreferredDay] = useState<number | null>(null);
  const [preferredTime, setPreferredTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(
    preselectedFriendId ? new Set([preselectedFriendId]) : new Set(),
  );

  const { data: recurringData, isLoading } = useQuery({
    queryKey: ['recurring'],
    queryFn: async () => {
      const res = await api.get('/recurring');
      return res.data.recurring as any[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/recurring', {
        title,
        frequency,
        preferredDay,
        preferredTime: preferredTime || null,
        durationMin,
        friendIds: Array.from(selectedFriendIds),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setShowCreate(false);
      setTitle('');
      setFrequency('biweekly');
      setPreferredDay(null);
      setPreferredTime('');
      setDurationMin(60);
      setSelectedFriendIds(new Set());
    },
  });

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const toggleFriend = (id: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔄</span>
          <h2 className="text-sm font-semibold text-gray-900">Recurring Hangouts</h2>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-slotted-50 px-2.5 py-1 text-xs font-medium text-slotted-600 hover:bg-slotted-100 transition-colors"
          >
            + New
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slotted-200 bg-slotted-50/30 p-4 space-y-3">
          <input
            type="text"
            placeholder="Hangout name (e.g. Friday Wine Night)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-slotted-300 focus:ring-1 focus:ring-slotted-200 outline-none"
            autoFocus
          />

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Frequency</p>
            <div className="flex gap-2">
              {[
                { value: 'weekly', label: 'Weekly' },
                { value: 'biweekly', label: 'Every 2 weeks' },
                { value: 'monthly', label: 'Monthly' },
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${frequency === f.value ? 'bg-slotted-100 text-slotted-700 ring-1 ring-slotted-200' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Preferred day</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setPreferredDay(preferredDay === i ? null : i)}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${preferredDay === i ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Preferred time</p>
            <div className="flex gap-2">
              {TIME_PREFS.map((t) => (
                <button
                  key={t}
                  onClick={() => setPreferredTime(preferredTime === t ? '' : t)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${preferredTime === t ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Duration</p>
            <div className="flex gap-2">
              {[30, 60, 90, 120].map((d) => (
                <button
                  key={d}
                  onClick={() => setDurationMin(d)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${durationMin === d ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                >
                  {d < 60 ? `${d}min` : `${d / 60}h`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Friends</p>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white">
              {acceptedFriends.map((f) => (
                <button
                  key={f.friend.id}
                  onClick={() => toggleFriend(f.friend.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${selectedFriendIds.has(f.friend.id) ? 'bg-slotted-50' : 'hover:bg-gray-50'}`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${selectedFriendIds.has(f.friend.id) ? 'bg-slotted-600 border-slotted-500 text-white' : 'border-gray-300'}`}>
                    {selectedFriendIds.has(f.friend.id) ? '✓' : ''}
                  </span>
                  <span className="text-gray-700">{f.friend.displayName}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!title.trim() || selectedFriendIds.size === 0 || createMutation.isPending}
              className="flex-1 rounded-lg bg-slotted-600 px-3 py-2 text-xs font-medium text-white hover:bg-slotted-600 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create recurring hangout'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-red-500">
              {(createMutation.error as any)?.response?.data?.error || 'Something went wrong'}
            </p>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && recurringData && recurringData.length > 0 && (
        <div className="space-y-2">
          {recurringData.map((m: any) => (
            <RecurringMeetupCard key={m.id} meetup={m} />
          ))}
        </div>
      )}

      {!isLoading && (!recurringData || recurringData.length === 0) && !showCreate && (
        <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-400">No recurring hangouts yet</p>
          <p className="mt-1 text-xs text-gray-300">Set one up and Slotted will auto-find times</p>
        </div>
      )}
    </div>
  );
}
