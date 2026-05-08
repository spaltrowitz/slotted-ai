import { useState } from 'react';
import api from '../lib/api';
import EventShowtimeCard from './EventShowtimeCard';
import EventPollBottomBar from './EventPollBottomBar';
import InviteFriendButton from './InviteFriendButton';
import type { ScheduleEvent, ScheduleShowtime } from './EventSearchModal';

interface EventShowtimesPollProps {
  event: ScheduleEvent;
  showtimes: ScheduleShowtime[];
  friendIds: string[];
}

export default function EventShowtimesPoll({
  event,
  showtimes,
  friendIds,
}: EventShowtimesPollProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | undefined>();
  const [pendingFriends] = useState<string[]>(() => {
    const names = new Set<string>();
    for (const s of showtimes) {
      for (const name of s.allFree) names.add(name);
      for (const c of s.conflicts) names.add(c.name);
    }
    return Array.from(names);
  });

  const sorted = [...showtimes].sort((a, b) => {
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
  });

  const toggleShowtime = (originalIndex: number) => {
    if (submitted) return;
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(originalIndex)) {
        next.delete(originalIndex);
      } else {
        next.add(originalIndex);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIndices.size === 0 || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post<{ scheduleId: string; success: boolean }>('/events/poll', {
        eventTitle: event.title,
        eventVenue: event.venue,
        eventImageUrl: event.imageUrl,
        eventUrl: showtimes.find((s) => s.ticketUrl)?.ticketUrl,
        showtimes,
        friendIds,
        selectedIndices: Array.from(selectedIndices).sort((a, b) => a - b),
      });
      setScheduleId(data.scheduleId);
      setSubmitted(true);
    } catch (err: unknown) {
      const maybeError = err as { response?: { data?: { error?: string } }; message?: string };
      setSubmitError(
        maybeError.response?.data?.error || maybeError.message || 'Could not confirm your dates. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <span className="text-3xl mb-3">🎭</span>
        <h3 className="text-base font-semibold text-gray-900">No showtimes found</h3>
        <p className="mt-1 text-sm text-gray-500 max-w-xs">
          We couldn't find upcoming showtimes for &ldquo;{event.title}&rdquo;. Try a different search or check back later.
        </p>
      </div>
    );
  }

  // Map sorted items back to their original index in the showtimes array
  const sortedWithOriginalIndex = sorted.map((s) => ({
    showtime: s,
    originalIndex: showtimes.indexOf(s),
  }));

  return (
    <div className="space-y-3 px-4 pt-4">
      {/* Event header */}
      <div className="flex items-center gap-3 mb-2">
        {event.imageUrl && (
          <img
            src={event.imageUrl}
            alt=""
            className="h-12 w-12 rounded-lg object-cover shadow-sm"
            loading="lazy"
          />
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {event.title}
          </h3>
          <p className="text-xs text-gray-500">{event.venue}</p>
        </div>
      </div>

      {submitted ? (
        <div className="rounded-xl bg-violet-50 border border-violet-200 p-3">
          <p className="text-sm font-medium text-violet-800">
            ✅ You submitted {selectedIndices.size} date{selectedIndices.size !== 1 ? 's' : ''}
          </p>
          <p className="mt-1 text-xs text-violet-600">
            Waiting for {pendingFriends.join(', ')}…
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Check all the dates that work for you
          {sorted[0]?.ticketUrl && (
            <>
              {' · '}
              <a
                href={sorted[0].ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-violet-600 hover:text-violet-800"
              >
                🎟️ Tickets
              </a>
            </>
          )}
        </p>
      )}

      {/* Invite friend */}
      <InviteFriendButton event={event} eventScheduleId={scheduleId} />

      {submitError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">{submitError}</p>
        </div>
      )}

      {/* Showtime cards */}
      <div className="space-y-2.5">
        {sortedWithOriginalIndex.map(({ showtime, originalIndex }) => (
          <EventShowtimeCard
            key={originalIndex}
            showtime={showtime}
            selected={selectedIndices.has(originalIndex)}
            onToggle={() => toggleShowtime(originalIndex)}
            disabled={submitted}
          />
        ))}
      </div>

      {/* Sticky bottom bar */}
      <EventPollBottomBar
        selectedCount={selectedIndices.size}
        submitted={submitted}
        submitting={submitting}
        pendingFriends={pendingFriends}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
