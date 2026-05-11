import { useEffect, useMemo, useState } from 'react';
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
  initialEventScheduleId?: string;
  initialSelectedDatetimes?: Set<string>;
  onDraftSaved?: (scheduleId: string) => void;
  onSelectionChange?: (datetimes: Set<string>) => void;
}

export default function EventShowtimesPoll({
  event,
  showtimes,
  friendIds = [],
  initialEventScheduleId,
  initialSelectedDatetimes = new Set<string>(),
  onDraftSaved,
  onSelectionChange,
}: EventShowtimesPollProps) {
  const orderedShowtimes = useMemo(
    () => [...showtimes].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()),
    [showtimes],
  );
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(orderedShowtimes
      .map((showtime, index) => initialSelectedDatetimes.has(showtime.datetime) ? index : null)
      .filter((index): index is number => index !== null)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [eventScheduleId, setEventScheduleId] = useState<string | undefined>(initialEventScheduleId);
  const [inviteUrl, setInviteUrl] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [pendingFriends] = useState<string[]>(() => {
    const names = new Set<string>();
    for (const s of orderedShowtimes) {
      for (const name of s.allFree) names.add(name);
      for (const c of s.conflicts) names.add(c.name);
    }
    return Array.from(names);
  });

  const showtimePayload = useMemo(() => orderedShowtimes.map(s => ({
    datetime: s.datetime,
    ticketUrl: s.ticketUrl,
    price: s.price,
  })), [orderedShowtimes]);

  useEffect(() => {
    let canceled = false;
    const saveDraft = async () => {
      setDraftStatus('saving');
      try {
        const { data } = await api.post<{ scheduleId: string }>('/events/poll-draft', {
          eventScheduleId,
          eventTitle: event.title,
          eventVenue: event.venue,
          eventImageUrl: event.imageUrl,
          showtimes: showtimePayload,
          friendIds,
        });
        if (!canceled) {
          setEventScheduleId(data.scheduleId);
          onDraftSaved?.(data.scheduleId);
          setDraftStatus('saved');
        }
      } catch (err: unknown) {
        console.error('Draft save failed:', err instanceof Error ? err.message : err);
        if (!canceled) setDraftStatus('error');
      }
    };

    void saveDraft();
    return () => {
      canceled = true;
    };
  }, [event.title, event.venue, event.imageUrl, friendIds, onDraftSaved, showtimePayload]);

  useEffect(() => {
    setSelectedIndices(new Set(orderedShowtimes
      .map((showtime, index) => initialSelectedDatetimes.has(showtime.datetime) ? index : null)
      .filter((index): index is number => index !== null)));
  }, [initialSelectedDatetimes, orderedShowtimes]);

  const toggleShowtime = (originalIndex: number) => {
    if (submitted) return;
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(originalIndex)) {
        next.delete(originalIndex);
      } else {
        next.add(originalIndex);
      }
      onSelectionChange?.(new Set(
        [...next]
          .map((index) => orderedShowtimes[index]?.datetime)
          .filter((datetime): datetime is string => Boolean(datetime)),
      ));
      return next;
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data: poll } = await api.post<{ scheduleId: string }>('/events/poll', {
        eventScheduleId,
        eventTitle: event.title,
        eventVenue: event.venue,
        eventImageUrl: event.imageUrl,
        showtimes: showtimePayload,
        friendIds,
        selectedIndices: Array.from(selectedIndices),
      });
      setEventScheduleId(poll.scheduleId);

      const { data: invite } = await api.post<{ inviteUrl: string }>('/events/friend-invite', {
        eventScheduleId: poll.scheduleId,
        eventTitle: event.title,
        friendIds,
      });
      setInviteUrl(invite.inviteUrl);
      setSubmitted(true);
    } catch (err: unknown) {
      console.error('Poll submission failed:', err instanceof Error ? err.message : err);
      setSubmitError('Could not create the poll link. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (orderedShowtimes.length === 0) {
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
        <PostSubmitShareSection
          event={event}
          pendingFriends={pendingFriends}
          eventScheduleId={eventScheduleId}
          inviteUrl={inviteUrl}
        />
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Check all the dates that work for you
            {' · '}
            <span className={
              draftStatus === 'saved'
                ? 'text-emerald-600'
                : draftStatus === 'error'
                  ? 'text-red-500'
                  : 'text-gray-400'
            }>
              {draftStatus === 'saved' ? 'Draft saved' : draftStatus === 'error' ? 'Draft not saved' : 'Saving draft…'}
            </span>
            {orderedShowtimes[0]?.ticketUrl && (
              <>
                {' · '}
                <a
                  href={orderedShowtimes[0].ticketUrl}
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
        {orderedShowtimes.map((showtime, index) => (
          <EventShowtimeCard
            key={`${showtime.datetime}-${index}`}
            showtime={showtime}
            selected={selectedIndices.has(index)}
            onToggle={() => toggleShowtime(index)}
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
        event={event}
        eventScheduleId={eventScheduleId}
        onSubmit={handleSubmit}
      />
      {submitError && (
        <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {submitError}
        </div>
      )}
    </div>
  );
}
