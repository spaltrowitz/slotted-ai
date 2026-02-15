import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

interface EventResult {
  id: string;
  source: 'seatgeek' | 'ticketmaster' | 'eventbrite' | 'meetup' | 'nyc_open_data';
  title: string;
  type: string;
  venue: string;
  city: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
  performers?: string[];
}

interface MatchedEvent extends EventResult {
  availabilityScore: number;
  note: string;
}

interface Friend {
  id: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

const EVENT_TYPES = [
  { value: '', label: 'All', emoji: '🔍' },
  { value: 'theater', label: 'Theater', emoji: '🎭' },
  { value: 'concert', label: 'Concerts', emoji: '🎵' },
  { value: 'sports', label: 'Sports', emoji: '⚽' },
];

function formatDateTime(dt: string): string {
  const d = new Date(dt);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatPrice(min?: number, max?: number): string {
  if (!min && !max) return '';
  if (min && max && min !== max) return `$${min}–$${max}`;
  return `$${min || max}`;
}

export default function EventsPage() {
  const { user } = useAuth();

  // Search state
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [defaultCity, setDefaultCity] = useState('');
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Results
  const [events, setEvents] = useState<EventResult[]>([]);
  const [matches, setMatches] = useState<MatchedEvent[]>([]);
  const [loading, setLoading]= useState(false);
  const [searched, setSearched] = useState(false);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number> | null>(null);
  const [matchMessage, setMatchMessage] = useState('');

  // Friend selection for availability matching
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [showFriendPicker, setShowFriendPicker] = useState(false);

  // Mode: 'search' = just browse events, 'match' = cross-reference with friend availability
  const [mode, setMode] = useState<'search' | 'match'>('search');

  // Load friends list + default city from user settings
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [friendsRes, meRes] = await Promise.all([
          api.get('/friends'),
          api.get('/users/me'),
        ]);
        const accepted = (friendsRes.data.friends || [])
          .filter((f: any) => f.status === 'accepted')
          .map((f: any) => f.friend);
        setFriends(accepted);
        const me = meRes.data;
        if (me.event_city) {
          setDefaultCity(me.event_city);
          if (!city) setCity(me.event_city);
        } else if (me.neighborhood) {
          setDefaultCity(me.neighborhood);
          if (!city) setCity(me.neighborhood);
        }
      } catch { /* ignore */ }
    })();
  }, [user]);

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    setEvents([]);
    setMatches([]);
    setMatchMessage('');
    setSourceCounts(null);

    try {
      if (mode === 'match' && selectedFriends.size > 0) {
        const { data } = await api.post('/events/match', {
          query: query.trim(),
          friendIds: Array.from(selectedFriends),
          city: city || undefined,
          type: eventType || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        setEvents(data.events || []);
        setMatches(data.matches || []);
        setMatchMessage(data.message || '');
      } else {
        const params: Record<string, string> = { q: query.trim() };
        if (city) params.city = city;
        if (eventType) params.type = eventType;
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;

        const { data } = await api.get('/events/search', { params });
        setEvents(data.events || []);
        setSourceCounts(data.sources || null);
      }
    } catch (err: any) {
      console.error('Event search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [query, city, eventType, dateFrom, dateTo, mode, selectedFriends]);

  const scoreColor = (score: number) =>
    score >= 80
      ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
      : score >= 60
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-gray-500 bg-gray-50 border-gray-200';

  const scoreEmoji = (score: number) =>
    score >= 85 ? '🔥' : score >= 70 ? '👍' : score >= 55 ? '🤔' : '😐';

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
          🎟️ Find Events
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Search Broadway shows, concerts, sports &amp; more — then match with friends' availability
        </p>
      </div>

      {/* Search bar */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm mb-5">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder='e.g. "Dog Day Afternoon Broadway" or "Taylor Swift NYC"'
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {loading ? 'Searching…' : '🔍 Search'}
          </button>
        </div>

        {/* Filters */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={defaultCity || 'City (e.g. New York)'}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none w-32 sm:w-40"
          />
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 overflow-x-auto">
            {EVENT_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setEventType(t.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  eventType === t.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none"
          />
        </div>

        {/* Mode toggle + friend picker */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setMode('search')}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${
                mode === 'search'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              🔍 Browse
            </button>
            <button
              onClick={() => setMode('match')}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${
                mode === 'match'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              ✨ Match with friends
            </button>
          </div>

          {mode === 'match' && (
            <button
              onClick={() => setShowFriendPicker(!showFriendPicker)}
              className="rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1.5 text-[11px] font-semibold text-slotted-700 transition-all hover:bg-slotted-100"
            >
              👥 {selectedFriends.size > 0 ? `${selectedFriends.size} selected` : 'Pick friends'}
            </button>
          )}
        </div>

        {/* Friend picker dropdown */}
        {mode === 'match' && showFriendPicker && (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3">
            {friends.length === 0 ? (
              <p className="text-xs text-gray-400">No friends yet — invite friends first!</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friends.map((f) => {
                  const selected = selectedFriends.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFriend(f.id)}
                      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                        selected
                          ? 'border-slotted-400 bg-slotted-100 text-slotted-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-slotted-200'
                      }`}
                    >
                      {f.photoUrl ? (
                        <img src={f.photoUrl} alt="" className="h-5 w-5 rounded-full" />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[9px] font-semibold text-white">
                          {f.displayName?.[0] ?? '?'}
                        </span>
                      )}
                      {selected ? '✓ ' : ''}{f.displayName?.split(' ')[0] || f.email}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slotted-400 border-t-transparent" />
          <p className="mt-3 text-sm text-gray-400">
            Searching SeatGeek &amp; Ticketmaster…
          </p>
        </div>
      )}

      {/* Match results (when matching with friends) */}
      {!loading && matches.length > 0 && (
        <div className="mb-5 rounded-2xl border border-slotted-200/60 bg-gradient-to-r from-slotted-50/40 to-purple-50/30 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">✨</span>
            <h2 className="font-display text-sm font-semibold text-gray-900">
              Showtimes when everyone is free
            </h2>
            <span className="ml-auto rounded-full bg-slotted-100 px-2 py-0.5 text-[10px] font-semibold text-slotted-700">
              {matches.length} match{matches.length !== 1 ? 'es' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {matches.map((m, i) => (
              <a
                key={m.id}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all hover:shadow-md ${
                  i === 0
                    ? 'border-slotted-200 bg-white shadow-sm'
                    : 'border-gray-200 bg-white/80 hover:bg-white'
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border ${scoreColor(m.availabilityScore)}`}>
                  <span className="text-xs font-bold">{m.availabilityScore}</span>
                </div>
                {m.imageUrl && (
                  <img src={m.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0 hidden sm:block" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{m.title}</p>
                    {i === 0 && (
                      <span className="rounded-full bg-gradient-to-r from-slotted-500 to-purple-500 px-2 py-0.5 text-[10px] font-bold text-white shrink-0">
                        Best match
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {formatDateTime(m.datetimeLocal || m.datetime)} · {m.venue}
                  </p>
                  <p className="text-[11px] text-slotted-600 font-medium mt-0.5">{m.note}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-lg">{scoreEmoji(m.availabilityScore)}</span>
                  {formatPrice(m.priceMin, m.priceMax) && (
                    <span className="text-[11px] font-semibold text-gray-500">
                      {formatPrice(m.priceMin, m.priceMax)}
                    </span>
                  )}
                  <span className="hidden sm:inline-flex rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-500">
                    🎟️ Tickets
                  </span>
                </div>
              </a>
            ))}
          </div>
          {matchMessage && (
            <p className="mt-3 text-center text-[11px] text-gray-400">{matchMessage}</p>
          )}
        </div>
      )}

      {/* Match mode message when no matches but events found */}
      {!loading && searched && mode === 'match' && matches.length === 0 && events.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3">
          <p className="text-xs text-amber-700">
            {matchMessage || 'No showtimes match everyone\'s availability. Browse all events below or try expanding the date range.'}
          </p>
        </div>
      )}

      {/* All events list */}
      {!loading && events.length > 0 && (
        <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🎟️</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">
                {mode === 'match' ? 'All Events Found' : 'Search Results'}
              </h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {events.length}
              </span>
            </div>
            {sourceCounts && (
              <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
                {Object.entries(sourceCounts)
                  .filter(([, count]) => count > 0)
                  .map(([source, count], idx, arr) => (
                    <span key={source}>
                      {source === 'seatgeek' ? 'SeatGeek' : source === 'ticketmaster' ? 'Ticketmaster' : source === 'eventbrite' ? 'Eventbrite' : source === 'meetup' ? 'Meetup' : source === 'nyc_open_data' ? 'NYC Free' : source}: {count}
                      {idx < arr.length - 1 ? ' ·' : ''}
                    </span>
                  ))}
              </div>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {events.map((ev) => (
              <a
                key={ev.id}
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/50"
              >
                {ev.imageUrl ? (
                  <img src={ev.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover shrink-0 shadow-sm" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xl">
                    {ev.type === 'theater' ? '🎭' : ev.type === 'concert' ? '🎵' : ev.type === 'sports' ? '⚽' : '🎟️'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {formatDateTime(ev.datetimeLocal || ev.datetime)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[11px] text-gray-400 truncate">
                      📍 {ev.venue}{ev.city ? `, ${ev.city}` : ''}
                    </p>
                    {ev.performers && ev.performers.length > 0 && (
                      <span className="text-[10px] text-gray-400 truncate">
                        · {ev.performers.slice(0, 2).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {formatPrice(ev.priceMin, ev.priceMax) && (
                    <span className="text-xs font-semibold text-gray-700">
                      {formatPrice(ev.priceMin, ev.priceMax)}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    ev.source === 'seatgeek'
                      ? 'bg-blue-50 text-blue-600'
                      : ev.source === 'ticketmaster'
                      ? 'bg-violet-50 text-violet-600'
                      : ev.source === 'eventbrite'
                      ? 'bg-orange-50 text-orange-600'
                      : ev.source === 'meetup'
                      ? 'bg-red-50 text-red-500'
                      : ev.source === 'nyc_open_data'
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-50 text-gray-600'
                  }`}>
                    {ev.source === 'seatgeek' ? 'SeatGeek'
                      : ev.source === 'ticketmaster' ? 'Ticketmaster'
                      : ev.source === 'eventbrite' ? 'Eventbrite'
                      : ev.source === 'meetup' ? 'Meetup'
                      : ev.source === 'nyc_open_data' ? 'NYC Free'
                      : ev.source}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && searched && events.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <span className="text-5xl mb-2">🎭</span>
            <h3 className="mt-3 font-display text-lg font-bold text-gray-900">
              No events found
            </h3>
            <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
              Try a different search term, broader date range, or different city.
            </p>
          </div>
        </div>
      )}

      {/* Initial state */}
      {!loading && !searched && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10">
          <div className="flex flex-col items-center text-center">
            <span className="text-4xl">🎟️</span>
            <h3 className="mt-3 font-display text-base font-bold text-gray-700">
              Search for live events
            </h3>
            <p className="mt-2 max-w-md text-sm text-gray-400 leading-relaxed">
              Search for Broadway shows, concerts, sports games, and more. Then switch to
              <strong> "Match with friends"</strong> mode to find showtimes when everyone is free.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {['Dog Day Afternoon Broadway', 'Hamilton NYC', 'Knicks', 'Adele concert'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setQuery(suggestion); }}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm transition-all hover:border-slotted-200 hover:bg-slotted-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
