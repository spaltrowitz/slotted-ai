import { useState, useEffect, useCallback, useRef } from 'react';
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

interface Suggestion {
  id: string;
  title: string;
  subtitle?: string;
  type: 'event' | 'performer' | 'venue';
  imageUrl?: string;
  source: 'seatgeek' | 'ticketmaster';
}

const EVENT_TYPES = [
  { value: '', label: 'All', emoji: '🔍' },
  { value: 'theater', label: 'Theater', emoji: '🎭' },
  { value: 'concert', label: 'Concerts', emoji: '🎵' },
  { value: 'sports', label: 'Sports', emoji: '⚽' },
  { value: 'comedy', label: 'Comedy', emoji: '😂' },
  { value: 'festivals', label: 'Festivals', emoji: '🎪' },
  { value: 'dance', label: 'Dance', emoji: '💃' },
  { value: 'food', label: 'Food & Drink', emoji: '🍷' },
  { value: 'community', label: 'Community', emoji: '🏘️' },
  { value: 'outdoors', label: 'Outdoors', emoji: '🌳' },
];

const DISCOVER_CATEGORIES = [
  { value: 'concert', label: 'Concerts & Music', emoji: '🎵', gradient: 'from-purple-500 to-pink-500' },
  { value: 'theater', label: 'Broadway & Theater', emoji: '🎭', gradient: 'from-amber-500 to-red-500' },
  { value: 'sports', label: 'Sports', emoji: '⚽', gradient: 'from-green-500 to-emerald-500' },
  { value: 'comedy', label: 'Comedy', emoji: '😂', gradient: 'from-yellow-500 to-orange-500' },
  { value: 'food', label: 'Food & Drink', emoji: '🍷', gradient: 'from-red-500 to-rose-500' },
  { value: 'community', label: 'Free & Community', emoji: '🏘️', gradient: 'from-blue-500 to-cyan-500' },
];

function formatDateTime(dt: string): string {
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return dt;
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }) + ' at ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dt;
  }
}

function formatPrice(min?: number, max?: number): string {
  if (min === 0 && (!max || max === 0)) return 'Free';
  if (!min && !max) return '';
  if (min && max && min !== max) return `$${min}–$${max}`;
  return `$${min || max}`;
}

const sourceLabel = (s: string) =>
  s === 'seatgeek' ? 'SeatGeek'
    : s === 'ticketmaster' ? 'Ticketmaster'
    : s === 'eventbrite' ? 'Eventbrite'
    : s === 'meetup' ? 'Meetup'
    : s === 'nyc_open_data' ? 'NYC Free'
    : s;

const sourceColor = (s: string) =>
  s === 'seatgeek' ? 'bg-blue-50 text-blue-600'
    : s === 'ticketmaster' ? 'bg-violet-50 text-violet-600'
    : s === 'eventbrite' ? 'bg-orange-50 text-orange-600'
    : s === 'meetup' ? 'bg-red-50 text-red-500'
    : s === 'nyc_open_data' ? 'bg-green-50 text-green-600'
    : 'bg-gray-50 text-gray-600';

const typeEmoji = (t: string) =>
  t === 'theater' || t === 'performing & visual arts' ? '🎭'
    : t === 'concert' || t === 'music' ? '🎵'
    : t === 'sports' || t === 'sports & fitness' ? '⚽'
    : t === 'comedy' ? '😂'
    : t === 'free event' || t === 'community event' ? '🏘️'
    : t === 'food' || t === 'food & drink' ? '🍷'
    : '🎟️';

export default function EventsPage() {
  const { user } = useAuth();

  // Search state
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [defaultCity, setDefaultCity] = useState('');
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Autocomplete
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);

  // Results
  const [events, setEvents] = useState<EventResult[]>([]);
  const [matches, setMatches] = useState<MatchedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number> | null>(null);
  const [matchMessage, setMatchMessage] = useState('');

  // Discover (category browsing)
  const [discoverEvents, setDiscoverEvents] = useState<EventResult[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverCategory, setDiscoverCategory] = useState('');
  const [discoverLoaded, setDiscoverLoaded] = useState(false);

  // Friend selection for availability matching
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [showFriendPicker, setShowFriendPicker] = useState(false);

  // Mode: 'search' = just browse events, 'match' = cross-reference with friend availability
  const [mode, setMode] = useState<'search' | 'match'>('search');

  // Tab: 'search' or 'discover'
  const [tab, setTab] = useState<'search' | 'discover'>('search');

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

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Autocomplete: debounced fetch as user types
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSuggestLoading(true);
    try {
      const params: Record<string, string> = { q };
      if (city) params.city = city;
      const { data } = await api.get('/events/suggest', { params });
      setSuggestions(data.suggestions || []);
      setShowSuggestions((data.suggestions || []).length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, [city]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    clearTimeout(suggestTimer.current);
    if (val.trim().length >= 2) {
      suggestTimer.current = setTimeout(() => fetchSuggestions(val.trim()), 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (s: Suggestion) => {
    setQuery(s.title);
    setShowSuggestions(false);
    setSuggestions([]);
    // Auto-search after selection
    setTimeout(() => handleSearch(s.title), 50);
  };

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery || query).trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    setEvents([]);
    setMatches([]);
    setMatchMessage('');
    setSourceCounts(null);
    setShowSuggestions(false);

    try {
      if (mode === 'match' && selectedFriends.size > 0) {
        const { data } = await api.post('/events/match', {
          query: q,
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
        const params: Record<string, string> = { q };
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

  // Discover: load local events by category
  const loadDiscover = useCallback(async (category?: string) => {
    setDiscoverLoading(true);
    try {
      const params: Record<string, string> = {};
      if (city) params.city = city;
      if (category) params.type = category;
      const { data } = await api.get('/events/discover', { params });
      setDiscoverEvents(data.events || []);
      setDiscoverLoaded(true);
    } catch (err) {
      console.error('Discover load failed:', err);
    } finally {
      setDiscoverLoading(false);
    }
  }, [city]);

  const handleDiscoverCategory = (cat: string) => {
    setDiscoverCategory(cat);
    loadDiscover(cat);
  };

  // Auto-load discover when switching to discover tab
  useEffect(() => {
    if (tab === 'discover' && !discoverLoaded && city) {
      loadDiscover(discoverCategory);
    }
  }, [tab, city]);

  const scoreColor = (score: number) =>
    score >= 80
      ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
      : score >= 60
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-gray-500 bg-gray-50 border-gray-200';

  const scoreEmoji = (score: number) =>
    score >= 85 ? '🔥' : score >= 70 ? '👍' : score >= 55 ? '🤔' : '😐';

  // Render an event card (reused in search results and discover)
  const renderEventCard = (ev: EventResult) => (
    <a
      key={ev.id}
      href={ev.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 sm:px-5 py-3.5 transition-colors hover:bg-gray-50/50"
    >
      {ev.imageUrl ? (
        <img src={ev.imageUrl} alt="" className="hidden sm:block h-14 w-14 rounded-xl object-cover shrink-0 shadow-sm" />
      ) : (
        <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xl">
          {typeEmoji(ev.type)}
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
            <span className="text-[10px] text-gray-400 truncate hidden sm:inline">
              · {ev.performers.slice(0, 2).join(', ')}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {formatPrice(ev.priceMin, ev.priceMax) && (
          <span className={`text-xs font-semibold ${ev.priceMin === 0 && (!ev.priceMax || ev.priceMax === 0) ? 'text-green-600' : 'text-gray-700'}`}>
            {formatPrice(ev.priceMin, ev.priceMax)}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${sourceColor(ev.source)}`}>
          {sourceLabel(ev.source)}
        </span>
      </div>
    </a>
  );

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
          🎟️ Events
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Search events, browse local listings, and match with friends' availability
        </p>
      </div>

      {/* Tab switcher: Search vs Discover */}
      <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 mb-5">
        <button
          onClick={() => setTab('search')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            tab === 'search'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          🔍 Search Events
        </button>
        <button
          onClick={() => setTab('discover')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            tab === 'discover'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          🗺️ Discover Local
        </button>
      </div>

      {/* ====== SEARCH TAB ====== */}
      {tab === 'search' && (
        <>
          {/* Search bar with autocomplete */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm mb-5">
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setShowSuggestions(false);
                        handleSearch();
                      }
                      if (e.key === 'Escape') setShowSuggestions(false);
                    }}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                    placeholder='Try "Hamilton", "Taylor Swift", "Knicks"...'
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                  />
                  {suggestLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slotted-300 border-t-transparent" />
                    </div>
                  )}

                  {/* Autocomplete dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      ref={suggestBoxRef}
                      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
                    >
                      {suggestions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => selectSuggestion(s)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slotted-50/50 border-b border-gray-50 last:border-b-0"
                        >
                          {s.imageUrl ? (
                            <img src={s.imageUrl} alt="" className="h-9 w-9 rounded-lg object-cover shrink-0" />
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 text-sm">
                              {s.type === 'performer' ? '🎤' : s.type === 'venue' ? '📍' : '🎟️'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{s.title}</p>
                            {s.subtitle && (
                              <p className="text-[11px] text-gray-400 truncate">{s.subtitle}</p>
                            )}
                          </div>
                          <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase ${sourceColor(s.source)}`}>
                            {sourceLabel(s.source)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleSearch()}
                  disabled={loading || !query.trim()}
                  className="rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {loading ? 'Searching…' : '🔍 Search'}
                </button>
              </div>
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
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 overflow-x-auto max-w-full">
                {EVENT_TYPES.slice(0, 5).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setEventType(t.value)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all whitespace-nowrap ${
                      eventType === t.value
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
                <div className="relative group">
                  <button className="rounded-md px-2 py-1 text-[11px] font-semibold text-gray-400 hover:text-gray-600 whitespace-nowrap">
                    More ▾
                  </button>
                  <div className="absolute right-0 top-full z-40 hidden group-hover:block pt-1">
                    <div className="rounded-lg border border-gray-200 bg-white shadow-lg p-1 min-w-[140px]">
                      {EVENT_TYPES.slice(5).map((t) => (
                        <button
                          key={t.value}
                          onClick={() => setEventType(t.value)}
                          className={`w-full rounded-md px-3 py-1.5 text-left text-[11px] font-semibold transition-all ${
                            eventType === t.value
                              ? 'bg-slotted-50 text-slotted-700'
                              : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {t.emoji} {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
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
                Searching SeatGeek, Ticketmaster &amp; more…
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
              <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">🎫</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900 truncate">
                    {mode === 'match' ? 'All Events Found' : 'Search Results'}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                    {events.length}
                  </span>
                </div>
                {sourceCounts && (
                  <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
                    {Object.entries(sourceCounts)
                      .filter(([, count]) => count > 0)
                      .map(([source, count], idx, arr) => (
                        <span key={source}>
                          {sourceLabel(source)}: {count}
                          {idx < arr.length - 1 ? ' ·' : ''}
                        </span>
                      ))}
                  </div>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {events.map(renderEventCard)}
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

          {/* Initial state — before any search */}
          {!loading && !searched && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 sm:p-10">
                <div className="flex flex-col items-center text-center">
                  <span className="text-4xl">🎟️</span>
                  <h3 className="mt-3 font-display text-base font-bold text-gray-700">
                    Search for live events
                  </h3>
                  <p className="mt-2 max-w-md text-sm text-gray-400 leading-relaxed">
                    Start typing to see autocomplete suggestions from SeatGeek &amp; Ticketmaster.
                    Switch to <strong>"Match with friends"</strong> mode to find times when everyone is free.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {['Hamilton NYC', 'Knicks', 'Wicked Broadway', 'Bad Bunny', 'Comedy Cellar'].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => { handleQueryChange(suggestion); setQuery(suggestion); setTimeout(() => handleSearch(suggestion), 50); }}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm transition-all hover:border-slotted-200 hover:bg-slotted-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ====== DISCOVER TAB ====== */}
      {tab === 'discover' && (
        <div className="space-y-5">
          {/* City header */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🗺️</span>
              <div className="flex-1">
                <h2 className="font-display text-base font-bold text-gray-900">
                  {city ? `Events near ${city}` : 'Discover local events'}
                </h2>
                <p className="text-xs text-gray-400">
                  Browse upcoming events in your area across all sources
                </p>
              </div>
              <input
                type="text"
                value={city}
                onChange={(e) => { setCity(e.target.value); setDiscoverLoaded(false); }}
                placeholder="Your city"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none w-36"
              />
            </div>
          </div>

          {/* Category cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {DISCOVER_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleDiscoverCategory(cat.value === discoverCategory ? '' : cat.value)}
                className={`relative overflow-hidden rounded-xl border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  discoverCategory === cat.value
                    ? 'border-slotted-300 bg-slotted-50 shadow-sm ring-2 ring-slotted-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`absolute top-0 right-0 h-16 w-16 rounded-bl-full bg-gradient-to-br ${cat.gradient} opacity-10`} />
                <span className="text-2xl">{cat.emoji}</span>
                <p className="mt-2 text-sm font-semibold text-gray-900">{cat.label}</p>
              </button>
            ))}
          </div>

          {/* Discover loading */}
          {discoverLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slotted-400 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-400">Finding events near {city || 'you'}…</p>
            </div>
          )}

          {/* Discover results */}
          {!discoverLoading && discoverLoaded && discoverEvents.length > 0 && (
            <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">📍</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900">
                    {discoverCategory
                      ? `${DISCOVER_CATEGORIES.find(c => c.value === discoverCategory)?.label || 'Events'} near ${city}`
                      : `Upcoming in ${city}`}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                    {discoverEvents.length}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {discoverEvents.map(renderEventCard)}
              </div>
            </div>
          )}

          {/* Discover empty or no city */}
          {!discoverLoading && discoverLoaded && discoverEvents.length === 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
              <span className="text-4xl">🤷</span>
              <h3 className="mt-3 font-display text-base font-bold text-gray-700">No events found</h3>
              <p className="mt-2 text-sm text-gray-400">
                {city
                  ? `Try a different category or check back later for events near ${city}.`
                  : 'Set your city above or in Settings to discover local events.'}
              </p>
            </div>
          )}

          {!discoverLoading && !discoverLoaded && !city && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
              <span className="text-4xl">📍</span>
              <h3 className="mt-3 font-display text-base font-bold text-gray-700">Set your city</h3>
              <p className="mt-2 text-sm text-gray-400">
                Enter your city above or set it in <strong>Settings → Event Preferences</strong> to browse local events.
              </p>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
