import { useState } from 'react';
import EventShowtimeCard from './EventShowtimeCard';
import EventPollBottomBar from './EventPollBottomBar';
import InviteFriendButton from './InviteFriendButton';
import PostSubmitShareSection from './PostSubmitShareSection';
import type { ScheduleEvent, ScheduleShowtime } from './EventSearchModal';
import api from '../lib/api';

interface EventShowtimesPollProps {
  event: ScheduleEvent;
  showtimes: ScheduleShowtime[];
  friendIds?: string[];
  friendNames?: string[];
}

export default function EventShowtimesPoll({
  event,
  showtimes,
  friendIds = [],
  friendNames = [],
}: EventShowtimesPollProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  // Friends to surface on the post-submit share screen. Derived from the
  // friend list the requester just picked — never from per-showtime
  // availability (which would leak who is free/busy).
  const [pendingFriends] = useState<string[]>(() => Array.from(new Set(friendNames)));

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
    setSubmitted(true);
    try {
      await api.post('/events/poll', {
        eventTitle: event.title,
        eventVenue: event.venue,
        eventImageUrl: event.imageUrl,
        showtimes: showtimes.map(s => ({
          datetime: s.datetime,
          ticketUrl: s.ticketUrl,
          price: s.price,
        })),
        friendIds,
        selectedIndices: Array.from(selectedIndices),
      });
    } catch (err: unknown) {
      console.error('Poll submission failed:', err instanceof Error ? err.message : err);
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
    <div className="px-4 pt-4 pb-28 space-y-3">
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
        <PostSubmitShareSection event={event} pendingFriends={pendingFriends} />
      ) : (
        <>
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
          {/* Invite friend */}
          <InviteFriendButton event={event} />
        </>
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
        pendingFriends={pendingFriends}
        event={event}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
