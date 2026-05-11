import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_PREFS = ['morning', 'afternoon', 'evening'] as const;
const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
] as const;

interface RecurringMeetup {
  id: string;
  title: string;
  activity_type: string | null;
  frequency: string;
  preferred_day: number | null;
  preferred_time: string | null;
  duration_min: number;
  is_active: boolean;
  last_scheduled_at: string | null;
  next_check_at: string | null;
  participants: { id: string; displayName: string }[];
}

interface RecurringMeetupCardProps {
  meetup: RecurringMeetup;
}

export default function RecurringMeetupCard({ meetup }: RecurringMeetupCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(meetup.title);
  const [frequency, setFrequency] = useState(meetup.frequency);
  const [preferredDay, setPreferredDay] = useState<number | null>(meetup.preferred_day);
  const [preferredTime, setPreferredTime] = useState(meetup.preferred_time || '');

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/recurring/${meetup.id}`, { isActive: !meetup.is_active });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/recurring/${meetup.id}`, {
        title,
        frequency,
        preferredDay,
        preferredTime: preferredTime || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/recurring/${meetup.id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  const freqLabel = FREQUENCIES.find((f) => f.value === meetup.frequency)?.label || meetup.frequency;
  const dayLabel = meetup.preferred_day !== null ? DAYS[meetup.preferred_day] : null;
  const nextCheck = meetup.next_check_at ? new Date(meetup.next_check_at) : null;

  return (
    <div className={`rounded-xl border p-4 transition-all ${meetup.is_active ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
      {!editing ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{meetup.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-slotted-50 px-2 py-0.5 text-[11px] font-medium text-slotted-700">
                  🔄 {freqLabel}
                </span>
                {dayLabel && (
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    {dayLabel}s
                  </span>
                )}
                {meetup.preferred_time && (
                  <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    {meetup.preferred_time}
                  </span>
                )}
                <span className="text-[11px] text-gray-400">{meetup.duration_min}min</span>
              </div>
            </div>

            <button
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${meetup.is_active ? 'bg-slotted-500' : 'bg-gray-200'}`}
              role="switch"
              aria-checked={meetup.is_active}
              aria-label="Toggle active"
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${meetup.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Participants */}
          <div className="mt-2.5 flex flex-wrap gap-1">
            {meetup.participants.map((p) => (
              <span key={p.id} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                {p.displayName}
              </span>
            ))}
          </div>

          {/* Next check */}
          {nextCheck && meetup.is_active && (
            <p className="mt-2 text-[11px] text-gray-400">
              Next check: {nextCheck.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this recurring hangout?')) deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-red-400 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-slotted-300 focus:ring-1 focus:ring-slotted-200 outline-none"
          />
          <div className="flex gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                onClick={() => setFrequency(f.value)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${frequency === f.value ? 'bg-slotted-100 text-slotted-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => setPreferredDay(preferredDay === i ? null : i)}
                className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${preferredDay === i ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {TIME_PREFS.map((t) => (
              <button
                key={t}
                onClick={() => setPreferredTime(preferredTime === t ? '' : t)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${preferredTime === t ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className="flex-1 rounded-lg bg-slotted-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slotted-600 transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
