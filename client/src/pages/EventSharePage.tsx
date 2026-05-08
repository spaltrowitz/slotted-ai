import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getFirstName } from '../lib/utils';

interface SharedEvent {
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  sharer: {
    displayName: string;
    photoUrl: string | null;
    inviteCode: string | null;
  };
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function buildGoogleCalendarUrl(event: SharedEvent) {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const inviteUrl = event.sharer.inviteCode
    ? `https://slotted-ai.web.app/invite/${event.sharer.inviteCode}`
    : 'https://slotted-ai.web.app';
  const details = [
    event.description || '',
    '',
    '---',
    'Created with Slotted.ai (https://slotted-ai.web.app)',
    'The app that helps friends find time to hang.',
    `Join: ${inviteUrl}`,
  ].join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Hangout',
    dates: `${fmt(event.startTime)}/${fmt(event.endTime)}`,
    details,
  });
  if (event.location) params.set('location', event.location);

  return `https://www.google.com/calendar/render?${params.toString()}`;
}

export default function EventSharePage() {
  const { code } = useParams<{ code: string }>();
  const [event, setEvent] = useState<SharedEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/meetups/shared/${code}`);
        if (!res.ok) throw new Error('Not found');
        setEvent(await res.json());
      } catch {
        setError("This event link isn't valid or has expired.");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slotted-50 via-white to-purple-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slotted-300 border-t-slotted-600" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slotted-50 via-white to-purple-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl"></div>
          <h1 className="mb-2 text-lg font-bold text-gray-900">Event Not Found</h1>
          <p className="mb-6 text-sm text-gray-500">{error}</p>
          <Link to="/" className="text-sm font-medium text-slotted-600 hover:text-slotted-700">
            Go to Slotted.ai →
          </Link>
        </div>
      </div>
    );
  }

  const inviteUrl = event.sharer.inviteCode
    ? `https://slotted-ai.web.app/invite/${event.sharer.inviteCode}`
    : 'https://slotted-ai.web.app';
  const icsUrl = `${API_BASE}/meetups/shared/${code}/ics`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slotted-50 via-white to-purple-50 p-6">
      <div className="w-full max-w-sm space-y-5">

        {/* Sharer info */}
        <div className="flex items-center justify-center gap-3">
          {event.sharer.photoUrl ? (
            <img src={event.sharer.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover shadow-sm" loading="lazy" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slotted-100 text-slotted-600 font-bold text-sm shadow-sm">
              {event.sharer.displayName[0]?.toUpperCase()}
            </div>
          )}
          <p className="text-sm text-gray-600">
            Shared by <span className="font-semibold text-gray-900">{getFirstName(event.sharer.displayName)}</span>
          </p>
        </div>

        {/* Event card */}
        <div className="rounded-2xl bg-white p-6 shadow-xl space-y-4">
          <h1 className="text-xl font-bold text-gray-900">{event.title || 'Hangout'}</h1>

          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span>{formatDateTime(event.startTime)}</span>
            </div>
            {event.endTime && event.endTime !== event.startTime && (
              <div className="flex items-center gap-2">
                <span>Until {formatDateTime(event.endTime)}</span>
              </div>
            )}
            {event.location && (
              <div className="flex items-center gap-2">
                <span>{event.location}</span>
              </div>
            )}
          </div>

          {event.description && (
            <p className="text-sm text-gray-500 border-t border-gray-100 pt-3">{event.description}</p>
          )}

          {/* Calendar buttons */}
          <div className="space-y-2 pt-2">
            <a
              href={buildGoogleCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slotted-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slotted-600"
            >
              Add to Google Calendar
            </a>
            <a
              href={icsUrl}
              download
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
            >
              Download Calendar File (.ics)
            </a>
          </div>
        </div>

        {/* Join Slotted.ai CTA */}
        <div className="rounded-2xl bg-white/80 p-5 text-center shadow-sm backdrop-blur">
          <p className="mb-1 text-sm font-semibold text-gray-900">Want to plan hangouts like this?</p>
          <p className="mb-3 text-xs text-gray-500">Slotted.ai syncs your calendar and finds the best time to meet up with friends.</p>
          <a
            href={inviteUrl}
            className="inline-block rounded-xl bg-slotted-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slotted-600"
          >
            Join Slotted.ai — it's free
          </a>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-500">
          Powered by <a href="https://slotted-ai.web.app" className="underline hover:text-gray-400">Slotted.ai</a>
        </p>
      </div>
    </div>
  );
}
