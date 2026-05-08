import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

interface ActivityPickerProps {
  date: string;
  startTime: string;
  endTime: string;
  onSelectEvent: (event: { title: string; venue: string; url: string; datetime: string }) => void;
  onSelectFreestyle: () => void;
}

interface EventResult {
  id: string;
  title: string;
  venue: string;
  type: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
}

const TYPE_EMOJI: Record<string, string> = {
  theater: '🎭', comedy: '😂', concert: '🎵', sports: '⚽',
  festival: '🎪', dance: '💃', music: '🎵', arts: '🎨',
};

export default function ActivityPicker({ date, startTime, endTime, onSelectEvent, onSelectFreestyle }: ActivityPickerProps) {
  const [mode, setMode] = useState<'choose' | 'events'>('choose');

  const dateStr = new Date(date).toISOString().split('T')[0];

  const { data, isLoading } = useQuery({
    queryKey: ['whats-happening', dateStr, startTime, endTime],
    queryFn: async () => {
      const { data } = await api.get('/events/whats-happening', {
        params: { date: dateStr, startTime, endTime },
      });
      return data as { events: EventResult[]; city: string; totalFound: number };
    },
    enabled: mode === 'events',
    staleTime: 1000 * 60 * 5,
  });

  // Build restaurant deep links with date/time/party size
  const partySize = 2; // default for a hangout
  const resyDate = new Date(date).toISOString().split('T')[0];
  const openTableDateTime = `${resyDate}T${startTime}`;
  const resyUrl = `https://resy.com/cities/ny?date=${resyDate}&seats=${partySize}`;
  const openTableUrl = `https://www.opentable.com/s?covers=${partySize}&dateTime=${openTableDateTime}`;

  if (mode === 'choose') {
    return (
      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm animate-in fade-in slide-in-from-bottom-2">
        <p className="text-sm font-semibold text-gray-900 mb-3">What do you want to do?</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onSelectFreestyle}
            className="rounded-lg border border-gray-200 bg-white p-3 text-center hover:bg-gray-50 transition-all min-h-[44px]"
          >
            <span className="text-lg">☕</span>
            <p className="text-xs font-medium text-gray-700 mt-1">Just hang out</p>
          </button>
          <a
            href={resyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onSelectFreestyle()}
            className="rounded-lg border border-gray-200 bg-white p-3 text-center hover:bg-gray-50 transition-all min-h-[44px]"
          >
            <span className="text-lg">🍽️</span>
            <p className="text-xs font-medium text-gray-700 mt-1">Go out for a meal</p>
          </a>
          <button
            onClick={() => setMode('events')}
            className="rounded-lg border border-gray-200 bg-white p-3 text-center hover:bg-gray-50 transition-all min-h-[44px]"
          >
            <span className="text-lg">🎟️</span>
            <p className="text-xs font-medium text-gray-700 mt-1">Find an event</p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">
          What's happening {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
        <button onClick={() => setMode('choose')} className="text-xs text-gray-500 hover:text-gray-700 min-h-[44px] px-2">
          ← Back
        </button>
      </div>

      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2.5 animate-pulse">
                <div className="h-10 w-10 rounded-lg bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-3/4 rounded bg-gray-200" />
                  <div className="h-2.5 w-1/2 rounded bg-gray-100" />
                </div>
              </div>
            ))}
            <p className="mt-1 text-center text-[11px] text-gray-400">Finding events near you…</p>
          </div>
        ) : !data?.events?.length ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No events found for this time.</p>
            <button onClick={onSelectFreestyle} className="mt-2 text-xs font-medium text-slotted-600 hover:text-slotted-700 min-h-[44px]">
              Just hang out instead →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {data.events.slice(0, 8).map((ev) => (
              <button
                key={ev.id}
                onClick={() => onSelectEvent({ title: ev.title, venue: ev.venue, url: ev.url, datetime: ev.datetimeLocal || ev.datetime })}
                className="w-full flex items-center gap-3 rounded-lg border border-gray-200 p-2.5 text-left hover:border-gray-300 hover:bg-gray-50/50 transition-all"
              >
                {ev.imageUrl ? (
                  <img src={ev.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" loading="lazy" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-100 to-pink-100 text-base">
                    {TYPE_EMOJI[ev.type?.toLowerCase()] || '🎟️'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{ev.title}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {ev.venue}
                    {ev.priceMin ? ` · $${ev.priceMin}${ev.priceMax && ev.priceMax !== ev.priceMin ? `–$${ev.priceMax}` : ''}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/50">
        <button onClick={onSelectFreestyle} className="text-xs font-medium text-gray-500 hover:text-gray-700 min-h-[44px]">
          Skip — just hang out ☕
        </button>
      </div>
    </div>
  );
}
