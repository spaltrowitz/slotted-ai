import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import {
  fetchDiscoverEvents,
  fetchEventSuggestions,
  fetchFriends,
  fetchSavedEvents,
  fetchUserSettings,
  queryKeys,
  type EventSuggestion,
  type SavedEvent,
} from '../lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventResult {
  id: string;
  source: string;
  sources?: string[];
  title: string;
  type: string;
  venue: string;
  city: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  urls?: { source: string; url: string }[];
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
  source: string;
}

type ShareableEvent = EventResult | EventSuggestion;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
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

// City-specific quick suggestions
const CITY_SUGGESTIONS: Record<string, string[]> = {
  'New York': ['Hamilton', 'Knicks', 'Wicked', 'Comedy Cellar', 'Brooklyn Nets'],
  'Los Angeles': ['Lakers', 'Hollywood Bowl', 'Dodgers', 'Comedy Store', 'Coachella'],
  'Chicago': ['Cubs', 'Second City', 'Wicked Chicago', 'Bears', 'Lollapalooza'],
  'Philadelphia': ['Eagles', '76ers', 'Phillies', 'Kimmel Center', 'Flyers'],
  'Providence': ['Providence Performing Arts', 'PawSox', 'Comedy Connection', 'Dunkin Donuts Center', 'WaterFire'],
  'San Francisco': ['Giants', 'Warriors', 'Outside Lands', 'Beach Blanket Babylon', 'Cobb Comedy'],
  'Boston': ['Red Sox', 'Celtics', 'Blue Man Group', 'Bruins', 'Boston Pops'],
  'Washington': ['Nationals', 'Kennedy Center', 'Capitals', 'Commanders', 'Hamilton DC'],
  'Houston': ['Astros', 'Texans', 'Rockets', 'Houston Rodeo', 'Comedy Showcase'],
  'Dallas': ['Cowboys', 'Mavericks', 'AT&T Stadium', 'Rangers', 'State Fair'],
  'Atlanta': ['Braves', 'Hawks', 'Fox Theatre', 'Falcons', 'Music Midtown'],
  'Miami': ['Heat', 'Dolphins', 'Ultra Music Festival', 'Hard Rock Stadium', 'Adrienne Arsht Center'],
  'Seattle': ['Seahawks', 'Mariners', 'Paramount Theatre', 'Sounders', 'Bumbershoot'],
  'Denver': ['Broncos', 'Nuggets', 'Red Rocks', 'Avalanche', 'Rockies'],
  'Portland': ['Trail Blazers', 'Timbers', 'Arlene Schnitzer', 'Helium Comedy', 'Thorns'],
  'Minneapolis': ['Vikings', 'Timberwolves', 'First Avenue', 'Twins', 'Guthrie Theater'],
  'Detroit': ['Lions', 'Tigers', 'Pistons', 'Fox Theatre Detroit', 'Red Wings'],
  'New Orleans': ['Saints', 'Pelicans', 'Jazz Fest', 'Saenger Theatre', 'Preservation Hall'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDateTime(dt: string): string {
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return dt;
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }) + ' at ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return dt; }
}

function formatPrice(min?: number, max?: number): string {
  if (min === 0 && (!max || max === 0)) return 'Free';
  if (!min && !max) return '';
  if (min && max && min !== max) return `$${min}–$${max}`;
  return `$${min || max}`;
}

const sourceLabel = (s: string) =>
  ({ seatgeek: 'SeatGeek', ticketmaster: 'Ticketmaster', eventbrite: 'Eventbrite', meetup: 'Meetup', nyc_open_data: 'NYC Free' }[s] || s);

const sourceColor = (s: string) =>
  ({ seatgeek: 'bg-blue-50 text-blue-600', ticketmaster: 'bg-violet-50 text-violet-600', eventbrite: 'bg-orange-50 text-orange-600', meetup: 'bg-red-50 text-red-500', nyc_open_data: 'bg-green-50 text-green-600' }[s] || 'bg-gray-50 text-gray-600');

const typeEmoji = (t: string) => {
  const lower = t?.toLowerCase() || '';
  if (lower.includes('theater') || lower.includes('arts')) return '🎭';
  if (lower.includes('concert') || lower.includes('music')) return '🎵';
  if (lower.includes('sport')) return '⚽';
  if (lower.includes('comedy')) return '😂';
  if (lower.includes('food') || lower.includes('drink')) return '🍷';
  if (lower.includes('community') || lower.includes('free')) return '🏘️';
  return '🎟️';
};

/** Extract major city name from a neighborhood string */
function extractMajorCity(input: string): string {
  if (!input) return '';
  const lower = input.toLowerCase().trim();
  const neighborhoodToCity: Record<string, string> = {
    // NYC
    'hudson yards': 'New York', 'hells kitchen': 'New York', "hell's kitchen": 'New York',
    'times square': 'New York', 'midtown': 'New York', 'midtown east': 'New York',
    'midtown west': 'New York', 'upper east side': 'New York', 'upper west side': 'New York',
    'lower east side': 'New York', 'west village': 'New York', 'east village': 'New York',
    'greenwich village': 'New York', 'soho': 'New York', 'noho': 'New York',
    'tribeca': 'New York', 'chelsea': 'New York', 'flatiron': 'New York',
    'gramercy': 'New York', 'gramercy park': 'New York', 'murray hill': 'New York',
    'kips bay': 'New York', 'union square': 'New York', 'nolita': 'New York',
    'chinatown': 'New York', 'little italy': 'New York', 'financial district': 'New York',
    'fidi': 'New York', 'battery park city': 'New York', 'harlem': 'New York',
    'east harlem': 'New York', 'washington heights': 'New York', 'inwood': 'New York',
    'morningside heights': 'New York', 'yorkville': 'New York', 'lenox hill': 'New York',
    'carnegie hill': 'New York', 'meatpacking': 'New York', 'meatpacking district': 'New York',
    'koreatown': 'New York', 'nomad': 'New York', 'stuyvesant town': 'New York',
    'stuy town': 'New York', 'alphabet city': 'New York', 'two bridges': 'New York',
    'dumbo': 'New York', 'williamsburg': 'New York', 'bushwick': 'New York',
    'park slope': 'New York', 'cobble hill': 'New York', 'boerum hill': 'New York',
    'carroll gardens': 'New York', 'red hook': 'New York', 'prospect heights': 'New York',
    'crown heights': 'New York', 'bed-stuy': 'New York', 'bedford-stuyvesant': 'New York',
    'fort greene': 'New York', 'clinton hill': 'New York', 'greenpoint': 'New York',
    'downtown brooklyn': 'New York', 'brooklyn heights': 'New York',
    'long island city': 'New York', 'astoria': 'New York', 'jackson heights': 'New York',
    'flushing': 'New York', 'forest hills': 'New York', 'woodside': 'New York',
    'south bronx': 'New York', 'riverdale': 'New York',
    'nyc': 'New York', 'ny': 'New York', 'new york city': 'New York',
    'manhattan': 'New York', 'brooklyn': 'New York', 'queens': 'New York',
    'bronx': 'New York', 'the bronx': 'New York', 'staten island': 'New York',
    // LA
    'hollywood': 'Los Angeles', 'santa monica': 'Los Angeles', 'beverly hills': 'Los Angeles',
    'west hollywood': 'Los Angeles', 'weho': 'Los Angeles', 'silver lake': 'Los Angeles',
    'echo park': 'Los Angeles', 'venice': 'Los Angeles', 'dtla': 'Los Angeles', 'la': 'Los Angeles',
    'culver city': 'Los Angeles', 'koreatown la': 'Los Angeles', 'los feliz': 'Los Angeles',
    'highland park': 'Los Angeles', 'burbank': 'Los Angeles', 'pasadena': 'Los Angeles',
    // Chicago
    'chi': 'Chicago', 'wicker park': 'Chicago', 'logan square': 'Chicago',
    'lincoln park': 'Chicago', 'lakeview': 'Chicago', 'the loop': 'Chicago',
    'river north': 'Chicago', 'old town': 'Chicago', 'bucktown': 'Chicago',
    'wrigleyville': 'Chicago', 'hyde park': 'Chicago', 'pilsen': 'Chicago',
    // SF
    'sf': 'San Francisco', 'san fran': 'San Francisco', 'the mission': 'San Francisco',
    'soma': 'San Francisco', 'north beach': 'San Francisco', 'castro': 'San Francisco',
    'haight': 'San Francisco', 'nob hill': 'San Francisco', 'pacific heights': 'San Francisco',
    'marina district': 'San Francisco', 'tenderloin': 'San Francisco',
    // Philadelphia
    'philly': 'Philadelphia', 'center city': 'Philadelphia', 'old city': 'Philadelphia',
    'south philly': 'Philadelphia', 'northern liberties': 'Philadelphia', 'fishtown': 'Philadelphia',
    'rittenhouse': 'Philadelphia', 'rittenhouse square': 'Philadelphia', 'university city': 'Philadelphia',
    'manayunk': 'Philadelphia', 'east passyunk': 'Philadelphia',
    // Providence
    'pvd': 'Providence', 'federal hill': 'Providence', 'college hill': 'Providence',
    'east side providence': 'Providence', 'downcity': 'Providence', 'fox point': 'Providence',
    'wayland square': 'Providence', 'thayer street': 'Providence',
    // Boston
    'bos': 'Boston', 'back bay': 'Boston', 'beacon hill': 'Boston', 'south end': 'Boston',
    'fenway': 'Boston', 'north end': 'Boston', 'seaport': 'Boston', 'south boston': 'Boston',
    'southie': 'Boston', 'cambridge': 'Boston', 'somerville': 'Boston', 'allston': 'Boston',
    // Houston
    'hou': 'Houston', 'montrose': 'Houston', 'the heights': 'Houston', 'midtown houston': 'Houston',
    'rice village': 'Houston', 'eado': 'Houston',
    // Dallas
    'dfw': 'Dallas', 'deep ellum': 'Dallas', 'uptown dallas': 'Dallas', 'bishop arts': 'Dallas',
    'oak lawn': 'Dallas', 'victory park': 'Dallas',
    // DC
    'dc': 'Washington', 'dupont circle': 'Washington', 'adams morgan': 'Washington',
    'georgetown': 'Washington', 'capitol hill': 'Washington', 'u street': 'Washington',
    'shaw': 'Washington', 'foggy bottom': 'Washington', 'navy yard': 'Washington',
    // Atlanta
    'atl': 'Atlanta', 'midtown atlanta': 'Atlanta', 'buckhead': 'Atlanta',
    'virginia-highland': 'Atlanta', 'old fourth ward': 'Atlanta', 'inman park': 'Atlanta',
    // Miami
    'mia': 'Miami', 'south beach': 'Miami', 'wynwood': 'Miami', 'brickell': 'Miami',
    'coral gables': 'Miami', 'coconut grove': 'Miami', 'little havana': 'Miami',
    // Seattle
    'sea': 'Seattle', 'capitol hill seattle': 'Seattle', 'ballard': 'Seattle',
    'fremont': 'Seattle', 'queen anne': 'Seattle', 'south lake union': 'Seattle',
    // Denver
    'den': 'Denver', 'lodo': 'Denver', 'rino': 'Denver', 'capitol hill denver': 'Denver',
    'cherry creek': 'Denver', 'highlands': 'Denver',
    // Portland
    'pdx': 'Portland', 'pearl district': 'Portland', 'alberta arts': 'Portland',
    'hawthorne': 'Portland', 'nw portland': 'Portland', 'division': 'Portland',
    // Minneapolis
    'mpls': 'Minneapolis', 'uptown mpls': 'Minneapolis', 'northeast minneapolis': 'Minneapolis',
    'north loop': 'Minneapolis',
    // Detroit
    'dtw': 'Detroit', 'corktown': 'Detroit', 'midtown detroit': 'Detroit',
    'eastern market': 'Detroit', 'greektown': 'Detroit',
    // New Orleans
    'nola': 'New Orleans', 'french quarter': 'New Orleans', 'marigny': 'New Orleans',
    'garden district': 'New Orleans', 'bywater': 'New Orleans', 'uptown new orleans': 'New Orleans',
  };
  if (neighborhoodToCity[lower]) return neighborhoodToCity[lower];
  const parts = input.split(',').map(p => p.trim());
  for (const part of [...parts].reverse()) {
    const partLower = part.toLowerCase();
    if (neighborhoodToCity[partLower]) return neighborhoodToCity[partLower];
  }
  if (parts.length > 1) return parts[parts.length - 1];
  return input.trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function EventsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const friendIdParam = searchParams.get('friend');
  const friendNameParam = searchParams.get('name');

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
  const [matchMessage, setMatchMessage] = useState('');

  // Discover
  const [discoverCategory, setDiscoverCategory] = useState('');
  const [discoverTimeFilter, setDiscoverTimeFilter] = useState<'all' | 'today' | 'tomorrow' | 'weekend'>('all');

  // Calendar view
  const [calMonthOffset, setCalMonthOffset] = useState(0);

  // Friends
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [mode, setMode] = useState<'search' | 'match'>('search');

  // Tab
  const [tab, setTab] = useState<'discover' | 'search' | 'saved' | 'calendar'>('discover');

  // Share modal
  const [shareEvent, setShareEvent] = useState<ShareableEvent | null>(null);
  const [shareFriends, setShareFriends] = useState<Set<string>>(new Set());
  const [shareMessage, setShareMessage] = useState('');
  const [shareSent, setShareSent] = useState(false);

  // Recent searches (localStorage-backed)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('slotted_recent_searches') || '[]'); } catch { return []; }
  });

  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  // Price filter
  const [priceFilter, setPriceFilter] = useState<'any' | 'free' | 'under50' | 'under100' | 'under200'>('any');

  // Smart suggestions (events matched to shared interests + availability)

  const { data: friendsData = [] } = useQuery({
    queryKey: queryKeys.friends,
    queryFn: fetchFriends,
    enabled: !!user,
  });

  const { data: settingsData } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchUserSettings,
    enabled: !!user,
  });

  const { data: savedEventsData = [], isLoading: savedEventsLoading } = useQuery({
    queryKey: queryKeys.events.saved,
    queryFn: fetchSavedEvents,
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const { data: smartSuggestions = [], isSuccess: smartLoaded } = useQuery({
    queryKey: queryKeys.events.suggestions,
    queryFn: fetchEventSuggestions,
    enabled: !!city,
  });

  const { data: trendingEvents = [] } = useQuery({
    queryKey: queryKeys.events.discover({ city, perPage: 8 }),
    queryFn: () => fetchDiscoverEvents({ city, perPage: 8 }),
    enabled: !!city,
  });

  const friends = useMemo<Friend[]>(() => {
    return friendsData
      .filter((f) => f.status === 'accepted')
      .map((f) => f.friend);
  }, [friendsData]);

  const savedEventIds = useMemo(() => {
    return new Set(
      savedEventsData
        .map((e) => e.external_id ?? e.id)
        .filter((id): id is string => Boolean(id))
    );
  }, [savedEventsData]);

  const savedEventsList = useMemo<EventResult[]>(() => {
    return savedEventsData
      .map((e) => ({
        id: e.external_id || e.id || '',
        source: e.source || '',
        title: e.title,
        type: e.event_type || 'event',
        venue: e.venue || '',
        city: e.city || '',
        datetime: e.datetime_utc || '',
        datetimeLocal: e.datetime_local || e.datetime_utc || '',
        url: e.url || '',
        imageUrl: e.image_url || '',
        priceMin: e.price_min !== undefined ? Number(e.price_min) : undefined,
        priceMax: e.price_max !== undefined ? Number(e.price_max) : undefined,
        performers: e.performers || [],
      }))
      .filter((e) => e.id);
  }, [savedEventsData]);

  useEffect(() => {
    const rawCity = settingsData?.event_city || settingsData?.neighborhood || '';
    const majorCity = extractMajorCity(rawCity);
    if (majorCity) {
      setDefaultCity(majorCity);
      if (!city) setCity(majorCity);
    }
  }, [settingsData, city]);

  useEffect(() => {
    if (!friendIdParam) return;
    setMode('match');
    setSelectedFriends(new Set([friendIdParam]));
    setTab('search');
  }, [friendIdParam]);

  const saveEventMutation = useMutation({
    mutationFn: async (event: EventResult) => {
      await api.post('/events/save', { event });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.saved });
    },
  });

  const matchEventsMutation = useMutation({
    mutationFn: async (payload: {
      query: string;
      friendIds: string[];
      city?: string;
      type?: string;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const { data } = await api.post('/events/match', payload);
      return data as { events?: EventResult[]; matches?: MatchedEvent[]; message?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.suggestions });
    },
  });

  const shareEventMutation = useMutation({
    mutationFn: async (payload: { friendIds: string[]; event: ShareableEvent; message?: string }) => {
      await api.post('/events/share', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  const shareSending = shareEventMutation.isPending;

  // ─── Click-outside to close suggestions ───
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ─── Autocomplete ───
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    setSuggestLoading(true);
    try {
      const params: Record<string, string> = { q };
      if (city) params.city = city;
      const { data } = await api.get('/events/suggest', { params });
      setSuggestions(data.suggestions || []);
      setShowSuggestions((data.suggestions || []).length > 0);
    } catch { setSuggestions([]); } finally { setSuggestLoading(false); }
  }, [city]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    clearTimeout(suggestTimer.current);
    if (val.trim().length >= 2) {
      suggestTimer.current = setTimeout(() => fetchSuggestions(val.trim()), 300);
    } else { setSuggestions([]); setShowSuggestions(false); }
  };

  const selectSuggestion = (s: Suggestion) => {
    setQuery(s.title);
    setShowSuggestions(false);
    setSuggestions([]);
    setTimeout(() => handleSearch(s.title), 50);
  };

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Search ───
  const addRecentSearch = useCallback((q: string) => {
    setRecentSearches((prev) => {
      const updated = [q, ...prev.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      try { localStorage.setItem('slotted_recent_searches', JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try { localStorage.removeItem('slotted_recent_searches'); } catch {}
  };

  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery || query).trim();
    if (!q) return;
    addRecentSearch(q);
    setTab('search');
    setLoading(true);
    setSearched(true);
    setEvents([]);
    setMatches([]);
    setMatchMessage('');
    setShowSuggestions(false);
    try {
      if (mode === 'match' && selectedFriends.size > 0) {
        const data = await matchEventsMutation.mutateAsync({
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
      }
    } catch (err) { console.error('Event search failed:', err); }
    finally { setLoading(false); }
  }, [query, city, eventType, dateFrom, dateTo, mode, selectedFriends, matchEventsMutation]);

  // ─── Discover ───
  const getTimeFilterDates = useCallback((filter: 'all' | 'today' | 'tomorrow' | 'weekend') => {
    const today = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (filter === 'today') {
      return { dateFrom: fmt(today), dateTo: fmt(today) };
    }
    if (filter === 'tomorrow') {
      const tmrw = new Date(today);
      tmrw.setDate(tmrw.getDate() + 1);
      return { dateFrom: fmt(tmrw), dateTo: fmt(tmrw) };
    }
    if (filter === 'weekend') {
      // Find next Saturday (or today if it's already Saturday)
      const dayOfWeek = today.getDay(); // 0=Sun
      const daysToSat = dayOfWeek === 6 ? 0 : dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
      const sat = new Date(today);
      sat.setDate(sat.getDate() + daysToSat);
      const sun = new Date(sat);
      sun.setDate(sun.getDate() + 1);
      return { dateFrom: fmt(sat), dateTo: fmt(sun) };
    }
    return {}; // 'all' — no date filter, API defaults to next 30 days
  }, []);

  const discoverParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (city) params.city = city;
    if (discoverCategory) params.type = discoverCategory;
    const dates = getTimeFilterDates(discoverTimeFilter);
    if (dates.dateFrom) params.dateFrom = dates.dateFrom;
    if (dates.dateTo) params.dateTo = dates.dateTo;
    return params;
  }, [city, discoverCategory, discoverTimeFilter, getTimeFilterDates]);

  const {
    data: discoverEvents = [],
    isFetching: discoverLoading,
    isSuccess: discoverLoaded,
  } = useQuery({
    queryKey: queryKeys.events.discover(discoverParams),
    queryFn: () => fetchDiscoverEvents(discoverParams),
    enabled: !!city && (tab === 'discover' || tab === 'calendar'),
  });

  const handleDiscoverCategory = (cat: string) => {
    setDiscoverCategory(cat);
  };

  const handleTimeFilter = (filter: 'all' | 'today' | 'tomorrow' | 'weekend') => {
    setDiscoverTimeFilter(filter);
  };

  // ─── Calendar helpers ───
  const calViewDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + calMonthOffset);
    return d;
  }, [calMonthOffset]);

  const calGrid = useMemo(() => {
    const year = calViewDate.getFullYear();
    const month = calViewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = new Date(firstDay);
    startDay.setDate(1 - firstDay.getDay());
    const weeks: string[][] = [];
    let cursor = new Date(startDay);
    for (let w = 0; w < 6; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(cursor.toLocaleDateString('en-CA'));
        cursor = new Date(cursor.getTime() + 86400000);
      }
      weeks.push(week);
    }
    return weeks;
  }, [calViewDate]);

  const calMonthLabel = calViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const currentMonth = calViewDate.getMonth();

  // Events for the calendar (from discover/trending)
  const calEvents = tab === 'calendar' ? (discoverLoaded ? discoverEvents : trendingEvents) : [];
  const eventsOnDate = useCallback((dateStr: string) => {
    return calEvents.filter((ev) => {
      const evDate = (ev.datetimeLocal || ev.datetime || '').slice(0, 10);
      return evDate === dateStr;
    });
  }, [calEvents]);

  // ─── Scoring helpers ───
  const scoreColor = (score: number) =>
    score >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
      : score >= 60 ? 'text-amber-600 bg-amber-50 border-amber-200'
      : 'text-gray-500 bg-gray-50 border-gray-200';

  const scoreEmoji = (score: number) =>
    score >= 85 ? '🔥' : score >= 70 ? '👍' : score >= 55 ? '🤔' : '😐';

  // ─── Save/bookmark event ───
  const handleSaveEvent = async (ev: EventResult) => {
    setSavingEventId(ev.id);
    const previousSavedEvents = queryClient.getQueryData<SavedEvent[]>(queryKeys.events.saved) ?? savedEventsData;
    try {
      if (savedEventIds.has(ev.id)) {
        queryClient.setQueryData(
          queryKeys.events.saved,
          previousSavedEvents.filter((e) => (e.external_id ?? e.id) !== ev.id),
        );
      } else {
        await saveEventMutation.mutateAsync(ev);
        const savedEvent: SavedEvent = {
          external_id: ev.id,
          id: ev.id,
          source: ev.source,
          title: ev.title,
          event_type: ev.type,
          venue: ev.venue,
          city: ev.city,
          datetime_utc: ev.datetime,
          datetime_local: ev.datetimeLocal,
          url: ev.url,
          image_url: ev.imageUrl,
          price_min: ev.priceMin,
          price_max: ev.priceMax,
          performers: ev.performers,
        };
        queryClient.setQueryData(queryKeys.events.saved, [savedEvent, ...previousSavedEvents]);
      }
    } catch (err) {
      console.error('Save failed:', err);
      queryClient.setQueryData(queryKeys.events.saved, previousSavedEvents);
    }
    finally { setSavingEventId(null); }
  };

  // ─── Price filter ───
  const filterByPrice = useCallback((evts: EventResult[]) => {
    if (priceFilter === 'any') return evts;
    return evts.filter((ev) => {
      const price = ev.priceMin ?? ev.priceMax ?? Infinity;
      if (priceFilter === 'free') return price === 0;
      if (priceFilter === 'under50') return price <= 50;
      if (priceFilter === 'under100') return price <= 100;
      if (priceFilter === 'under200') return price <= 200;
      return true;
    });
  }, [priceFilter]);

  const filteredEvents = useMemo(() => filterByPrice(events), [events, filterByPrice]);
  const filteredDiscoverEvents = useMemo(() => filterByPrice(discoverEvents), [discoverEvents, filterByPrice]);

  // ─── Quick suggestions based on city ───
  const quickSuggestions = CITY_SUGGESTIONS[city] || CITY_SUGGESTIONS['New York'] || [];

  // ─── Share event with friends ───
  const openShareModal = (ev: ShareableEvent) => {
    setShareEvent(ev);
    setShareFriends(new Set());
    setShareMessage('');
    setShareSent(false);
  };

  const toggleShareFriend = (id: string) => {
    setShareFriends((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleShare = async () => {
    if (!shareEvent || shareFriends.size === 0) return;
    try {
      await shareEventMutation.mutateAsync({
        friendIds: Array.from(shareFriends),
        event: shareEvent,
        message: shareMessage || undefined,
      });
      setShareSent(true);
      setTimeout(() => { setShareEvent(null); setShareSent(false); }, 1500);
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Event card renderer
  // ---------------------------------------------------------------------------
  const renderEventCard = (ev: EventResult) => {
    const allSources = ev.sources || [ev.source];
    // Deduplicate URLs by source — only show one link per source
    const rawUrls = ev.urls || [{ source: ev.source, url: ev.url }];
    const seenSources = new Set<string>();
    const allUrls = rawUrls.filter(({ source: s }) => {
      if (seenSources.has(s)) return false;
      seenSources.add(s);
      return true;
    });
    const primaryUrl = allUrls[0]?.url || ev.url;
    return (
      <div
        key={ev.id}
        className="flex items-center gap-3 px-4 sm:px-5 py-3.5 transition-colors hover:bg-gray-50/50 cursor-pointer"
        onClick={(e) => {
          // Only navigate if the click wasn't on a button or link
          const target = e.target as HTMLElement;
          if (target.closest('button') || target.closest('a')) return;
          window.open(primaryUrl, '_blank');
        }}
      >        {ev.imageUrl ? (
          <img src={ev.imageUrl} alt="" className="hidden sm:block h-14 w-14 rounded-xl object-cover shrink-0 shadow-sm" loading="lazy" />
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
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {formatPrice(ev.priceMin, ev.priceMax) && (
            <span className={`text-xs font-semibold ${ev.priceMin === 0 && (!ev.priceMax || ev.priceMax === 0) ? 'text-green-600' : 'text-gray-700'}`}>
              {formatPrice(ev.priceMin, ev.priceMax)}
            </span>
          )}
          {/* Save + share + ticket links */}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleSaveEvent(ev); }}
              disabled={savingEventId === ev.id}
              className={`rounded-full p-1.5 transition-all ${
                savedEventIds.has(ev.id)
                  ? 'text-red-500 hover:text-red-600'
                  : 'text-gray-300 hover:text-red-400 hover:bg-red-50'
              }`}
              title={savedEventIds.has(ev.id) ? 'Saved' : 'Save for later'}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill={savedEventIds.has(ev.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openShareModal(ev); }}
              className="rounded-full p-1.5 text-gray-400 hover:text-slotted-600 hover:bg-slotted-50 transition-all"
              title="Send to a friend"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
            {allUrls.map(({ source: s, url }) => (
              <a
                key={s}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`rounded-full px-2.5 py-1 text-[10px] sm:text-[9px] font-semibold uppercase tracking-wider transition-all hover:opacity-80 ${sourceColor(s)}`}
                title={`Buy on ${sourceLabel(s)}`}
              >
                {allSources.length > 1 ? '🎟️' : ''} {sourceLabel(s)}
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const shareEventType = shareEvent && 'type' in shareEvent ? shareEvent.type : 'event';
  const shareEventDate = shareEvent
    ? shareEvent.datetimeLocal || ('datetime' in shareEvent ? shareEvent.datetime : '')
    : '';

  // Compact card for trending section
  const renderCompactCard = (ev: EventResult) => (
    <a
      key={ev.id}
      href={ev.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-gray-100 bg-white p-3 transition-all hover:shadow-md hover:-translate-y-0.5 overflow-hidden"
    >
      {ev.imageUrl && (
        <img src={ev.imageUrl} alt="" className="h-28 w-full rounded-lg object-cover mb-2" loading="lazy" />
      )}
      <p className="text-xs font-semibold text-gray-900 truncate">{ev.title}</p>
      <p className="text-[10px] text-gray-500 truncate mt-0.5">
        {formatDateTime(ev.datetimeLocal || ev.datetime)}
      </p>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-400 truncate">📍 {ev.venue}</span>
        {formatPrice(ev.priceMin, ev.priceMax) && (
          <span className={`text-[10px] font-bold ${ev.priceMin === 0 ? 'text-green-600' : 'text-gray-600'}`}>
            {formatPrice(ev.priceMin, ev.priceMax)}
          </span>
        )}
      </div>
    </a>
  );

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">
          {friendNameParam ? `🎟️ Find something to do with ${friendNameParam}` : '🎟️ Things to Do'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {friendNameParam
            ? `Search for events and find times when you're both free${city ? ` in ${city}` : ''}`
            : `Find events, match with friends' schedules, and never miss a great show${city ? ` in ${city}` : ''}`}
        </p>
        {friendNameParam && (
          <a href="/friends" className="mt-2 inline-flex items-center gap-1 text-xs text-slotted-600 hover:text-slotted-700 transition-colors">
            ← Back to Friends
          </a>
        )}
      </div>

      {/* ─── Smart Picks: Events matched to you + friends ─── */}
      {smartLoaded && smartSuggestions.length > 0 && tab === 'search' && !searched && (
        <div className="mb-5 rounded-2xl border border-slotted-200/40 bg-gradient-to-r from-slotted-50/30 to-purple-50/20 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slotted-100/50">
            <div className="flex items-center gap-2">
              <span className="text-base">🎯</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">Events to do with friends</h2>
            </div>
            <span className="text-[10px] font-medium text-slotted-500">Based on shared interests &amp; availability</span>
          </div>
          <div className="divide-y divide-slotted-100/30">
            {smartSuggestions.slice(0, 4).map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/50">
                {ev.imageUrl ? (
                  <img src={ev.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0 shadow-sm" loading="lazy" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 text-lg">🎟️</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {ev.datetimeLocal ? new Date(ev.datetimeLocal).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                    {ev.venue ? ` · ${ev.venue}` : ''}
                  </p>
                  <p className="text-[11px] text-slotted-600 font-medium mt-0.5 truncate">{ev.reason}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="flex -space-x-1.5">
                    {(ev.matchingFriends || []).slice(0, 3).map((f) => (
                      f.photo ? (
                        <img key={f.id} src={f.photo} alt="" className="h-6 w-6 rounded-full ring-2 ring-white" title={f.name} loading="lazy" />
                      ) : (
                        <div key={f.id} className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[8px] font-bold text-white ring-2 ring-white" title={f.name}>
                          {f.name?.[0]}
                        </div>
                      )
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openShareModal(ev)} className="rounded-full p-1 text-gray-400 hover:text-slotted-600 hover:bg-slotted-50 transition-all" title="Send to friend">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    </button>
                    {ev.url && (
                      <a href={ev.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        className="rounded-full bg-slotted-100 px-2 py-0.5 text-[9px] font-semibold text-slotted-700 hover:bg-slotted-200 transition-all">
                        🎟️ Tickets
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Trending / What's Hot ─── */}
      {!searched && trendingEvents.length > 0 && tab === 'search' && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🔥</span>
              <h2 className="font-display text-sm font-semibold text-gray-900">
                Trending in {city || 'your area'}
              </h2>
            </div>
            <button
              onClick={() => { setTab('discover'); }}
              className="text-[11px] font-semibold text-slotted-600 hover:text-slotted-700 transition-colors"
            >
              See all →
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {trendingEvents.slice(0, 4).map(renderCompactCard)}
          </div>
        </div>
      )}

      {/* ─── Tab Switcher ─── */}
      <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 mb-5">
        {(['discover', 'search', 'saved', 'calendar'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs sm:text-sm font-semibold transition-all ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'discover' ? '🗺️ Discover' : t === 'search' ? '🔍 Search' : t === 'saved' ? `❤️ Saved${savedEventIds.size > 0 ? ` (${savedEventIds.size})` : ''}` : '📅 Calendar'}
          </button>
        ))}
      </div>

      {/* ====== SEARCH TAB ====== */}
      {tab === 'search' && (
        <>
          {/* Search bar */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-4 sm:p-5 shadow-sm mb-5">
            <div className="flex gap-2">
              <div className="relative flex-1" ref={inputRef as any}>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { setShowSuggestions(false); handleSearch(); }
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                  placeholder={`Search events in ${city || 'your city'}…`}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                />
                {suggestLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slotted-300 border-t-transparent" />
                  </div>
                )}
                {/* Autocomplete dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div ref={suggestBoxRef} className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 sm:max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => selectSuggestion(s)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slotted-50/50 border-b border-gray-50 last:border-b-0"
                      >
                        {s.imageUrl ? (
                          <img src={s.imageUrl} alt="" className="h-9 w-9 rounded-lg object-cover shrink-0" loading="lazy" />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 text-sm">
                            {s.type === 'performer' ? '🎤' : s.type === 'venue' ? '📍' : '🎟️'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.title}</p>
                          {s.subtitle && <p className="text-[11px] text-gray-400 truncate">{s.subtitle}</p>}
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
                {loading ? '…' : '🔍'}
              </button>
            </div>

            {/* Filters row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={defaultCity || 'City'}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none w-28 sm:w-36"
              />
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 overflow-x-auto">
                {EVENT_TYPES.slice(0, 5).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setEventType(t.value)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all whitespace-nowrap ${
                      eventType === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
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
                            eventType === t.value ? 'bg-slotted-50 text-slotted-700' : 'text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {t.emoji} {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none" />
              <span className="text-xs text-gray-400">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none" />
            </div>

            {/* Price filter + date presets */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-gray-400 font-medium">Price:</span>
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {([
                  { value: 'any' as const, label: 'Any' },
                  { value: 'free' as const, label: 'Free' },
                  { value: 'under50' as const, label: '<$50' },
                  { value: 'under100' as const, label: '<$100' },
                  { value: 'under200' as const, label: '<$200' },
                ] as const).map((p) => (
                  <button key={p.value} onClick={() => setPriceFilter(p.value)}
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-all whitespace-nowrap ${
                      priceFilter === p.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-gray-400 font-medium ml-1">Quick:</span>
              {([
                { label: 'Today', from: () => { const d = new Date(); return d.toLocaleDateString('en-CA'); }, to: () => { const d = new Date(); return d.toLocaleDateString('en-CA'); } },
                { label: 'This Weekend', from: () => { const d = new Date(); const day = d.getDay(); const sat = new Date(d); sat.setDate(d.getDate() + (day === 6 ? 0 : day === 0 ? 6 : 6 - day)); return sat.toLocaleDateString('en-CA'); }, to: () => { const d = new Date(); const day = d.getDay(); const sun = new Date(d); sun.setDate(d.getDate() + (day === 0 ? 0 : 7 - day)); return sun.toLocaleDateString('en-CA'); } },
                { label: 'Next Week', from: () => { const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay() + 1)); return d.toLocaleDateString('en-CA'); }, to: () => { const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay() + 7)); return d.toLocaleDateString('en-CA'); } },
                { label: 'This Month', from: () => new Date().toLocaleDateString('en-CA'), to: () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toLocaleDateString('en-CA'); } },
              ]).map((preset) => (
                <button key={preset.label}
                  onClick={() => { setDateFrom(preset.from()); setDateTo(preset.to()); }}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-500 hover:border-slotted-200 hover:bg-slotted-50 hover:text-slotted-600 transition-all">
                  {preset.label}
                </button>
              ))}
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-[10px] text-gray-400 hover:text-red-400 transition-colors">✕ Clear</button>
              )}
            </div>

            {/* Match mode + friend picker */}
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button onClick={() => setMode('search')}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${mode === 'search' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  🔍 Browse
                </button>
                <button onClick={() => setMode('match')}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${mode === 'match' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  ✨ Match with friends
                </button>
              </div>
              {mode === 'match' && (
                <button onClick={() => setShowFriendPicker(!showFriendPicker)}
                  className="rounded-lg border border-slotted-200 bg-slotted-50 px-3 py-1.5 text-[11px] font-semibold text-slotted-700 transition-all hover:bg-slotted-100">
                  👥 {selectedFriends.size > 0 ? `${selectedFriends.size} selected` : 'Pick friends'}
                </button>
              )}
            </div>

            {/* Friend picker */}
            {mode === 'match' && showFriendPicker && (
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3">
                {friends.length === 0 ? (
                  <p className="text-xs text-gray-400">No friends yet — invite friends first!</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {friends.map((f) => {
                      const selected = selectedFriends.has(f.id);
                      return (
                        <button key={f.id} onClick={() => toggleFriend(f.id)}
                          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                            selected ? 'border-slotted-400 bg-slotted-100 text-slotted-700' : 'border-gray-200 bg-white text-gray-600 hover:border-slotted-200'
                          }`}>
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

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slotted-400 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-400">Searching across SeatGeek, Ticketmaster &amp; more…</p>
            </div>
          )}

          {/* Match results */}
          {!loading && matches.length > 0 && (
            <div className="mb-5 rounded-2xl border border-slotted-200/60 bg-gradient-to-r from-slotted-50/40 to-purple-50/30 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">✨</span>
                <h2 className="font-display text-sm font-semibold text-gray-900">
                  Times everyone is free
                </h2>
                <span className="ml-auto rounded-full bg-slotted-100 px-2 py-0.5 text-[10px] font-semibold text-slotted-700">
                  {matches.length} match{matches.length !== 1 ? 'es' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {matches.map((m, i) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all hover:shadow-md ${
                      i === 0 ? 'border-slotted-200 bg-white shadow-sm' : 'border-gray-200 bg-white/80 hover:bg-white'
                    }`}>
                    <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border ${scoreColor(m.availabilityScore)}`}>
                      <span className="text-xs font-bold">{m.availabilityScore}</span>
                    </div>
                    {m.imageUrl && <img src={m.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0 hidden sm:block" loading="lazy" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{m.title}</p>
                        {i === 0 && <span className="rounded-full bg-gradient-to-r from-slotted-500 to-purple-500 px-2 py-0.5 text-[10px] font-bold text-white shrink-0">Best match</span>}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{formatDateTime(m.datetimeLocal || m.datetime)} · {m.venue}</p>
                      <p className="text-[11px] text-slotted-600 font-medium mt-0.5">{m.note}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-lg">{scoreEmoji(m.availabilityScore)}</span>
                      {formatPrice(m.priceMin, m.priceMax) && <span className="text-[11px] font-semibold text-gray-500">{formatPrice(m.priceMin, m.priceMax)}</span>}
                    </div>
                  </a>
                ))}
              </div>
              {matchMessage && <p className="mt-3 text-center text-[11px] text-gray-400">{matchMessage}</p>}
            </div>
          )}

          {/* No-match banner */}
          {!loading && searched && mode === 'match' && matches.length === 0 && events.length > 0 && (
            <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3">
              <p className="text-xs text-amber-700">
                {matchMessage || "No showtimes match everyone's availability. Browse all events below or try expanding the date range."}
              </p>
            </div>
          )}

          {/* All events list */}
          {!loading && filteredEvents.length > 0 && (
            <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">🎫</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900 truncate">
                    {mode === 'match' ? 'All Events Found' : 'Search Results'}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{filteredEvents.length}{priceFilter !== 'any' ? ` of ${events.length}` : ''}</span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">{filteredEvents.map(renderEventCard)}</div>
            </div>
          )}

          {/* Empty state */}
          {!loading && searched && filteredEvents.length === 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-col items-center justify-center px-6 py-16">
                <span className="text-4xl sm:text-5xl mb-2">🎭</span>
                <h3 className="mt-3 font-display text-lg font-bold text-gray-900">No events found</h3>
                <p className="mt-2 max-w-sm text-center text-sm text-gray-400 leading-relaxed">
                  {priceFilter !== 'any' && events.length > 0
                    ? `${events.length} events found but none match your price filter. Try adjusting the price range.`
                    : 'Try a different search term, broader date range, or different city.'}
                </p>
              </div>
            </div>
          )}

          {/* Pre-search discovery content */}
          {!loading && !searched && (
            <div className="space-y-5">
              {/* Recent searches */}
              {recentSearches.length > 0 && (
                <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🕔</span>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent Searches</h3>
                    </div>
                    <button onClick={clearRecentSearches} className="text-[10px] text-gray-400 hover:text-red-400 transition-colors">Clear</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((s) => (
                      <button key={s}
                        onClick={() => { setQuery(s); setTimeout(() => handleSearch(s), 50); }}
                        className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 transition-all hover:border-slotted-200 hover:bg-slotted-50 hover:text-slotted-700 flex items-center gap-1.5">
                        <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick search suggestions */}
              <div className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">💡</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900">
                    Ideas{city ? ` in ${city}` : ''}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {quickSuggestions.map((s) => (
                    <button key={s}
                      onClick={() => { handleQueryChange(s); setQuery(s); setTimeout(() => handleSearch(s), 50); }}
                      className="rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-slotted-200 hover:bg-slotted-50 hover:text-slotted-700">
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Friends prompt */}
              {friends.length > 0 && (
                <div className="rounded-2xl border border-slotted-100 bg-gradient-to-r from-slotted-50/30 to-purple-50/20 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">👯</span>
                    <div className="flex-1">
                      <h3 className="font-display text-sm font-bold text-gray-900">Plan something with friends</h3>
                      <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                        Search for an event, then switch to <strong>"Match with friends"</strong> to find
                        showings when everyone is free. Slotted.ai checks all your calendars automatically.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {friends.slice(0, 5).map((f) => (
                          <span key={f.id} className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                            {f.photoUrl ? (
                              <img src={f.photoUrl} alt="" className="h-4 w-4 rounded-full" loading="lazy" />
                            ) : (
                              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-slotted-400 to-purple-500 text-[8px] font-bold text-white">
                                {f.displayName?.[0] ?? '?'}
                              </span>
                            )}
                            {f.displayName?.split(' ')[0] || f.email}
                          </span>
                        ))}
                        {friends.length > 5 && (
                          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-400">
                            +{friends.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* How it works */}
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-5">
                <p className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">How it works</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { emoji: '🔍', title: 'Search', desc: 'Find concerts, shows, sports & more from SeatGeek, Ticketmaster, and other sources' },
                    { emoji: '👥', title: 'Match', desc: "Pick friends and we'll cross-reference everyone's calendar to find times that work" },
                    { emoji: '🎟️', title: 'Book', desc: 'Get direct links to buy tickets — with price comparisons across multiple platforms' },
                  ].map((step) => (
                    <div key={step.title} className="text-center">
                      <span className="text-2xl">{step.emoji}</span>
                      <p className="mt-1 text-xs font-bold text-gray-700">{step.title}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400 leading-relaxed">{step.desc}</p>
                    </div>
                  ))}
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
                  {city ? `What's happening in ${city}` : 'Discover local events'}
                </h2>
                <p className="text-xs text-gray-400">Browse upcoming events across all sources</p>
              </div>
              <input type="text" value={city}
                onChange={(e) => { setCity(e.target.value); }}
                placeholder="Your city"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm focus:border-slotted-400 focus:outline-none w-36" />
            </div>
          </div>

          {/* Category cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {DISCOVER_CATEGORIES.map((cat) => (
              <button key={cat.value}
                onClick={() => handleDiscoverCategory(cat.value === discoverCategory ? '' : cat.value)}
                className={`relative overflow-hidden rounded-xl border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  discoverCategory === cat.value
                    ? 'border-slotted-300 bg-slotted-50 shadow-sm ring-2 ring-slotted-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}>
                <div className={`absolute top-0 right-0 h-16 w-16 rounded-bl-full bg-gradient-to-br ${cat.gradient} opacity-10`} />
                <span className="text-2xl">{cat.emoji}</span>
                <p className="mt-2 text-sm font-semibold text-gray-900">{cat.label}</p>
              </button>
            ))}
          </div>

          {/* Loading */}
          {discoverLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slotted-400 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-400">Finding events near {city || 'you'}…</p>
            </div>
          )}

          {/* Time filter toggles */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 shrink-0">When:</span>
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 overflow-x-auto">
              {[
                { value: 'all' as const, label: '📅 All', desc: 'Next 30 days' },
                { value: 'today' as const, label: '☀️ Today', desc: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) },
                { value: 'tomorrow' as const, label: '🌅 Tomorrow', desc: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })() },
                { value: 'weekend' as const, label: '🎉 This Weekend', desc: (() => {
                  const today = new Date();
                  const day = today.getDay();
                  const daysToSat = day === 6 ? 0 : day === 0 ? 6 : 6 - day;
                  const sat = new Date(today); sat.setDate(sat.getDate() + daysToSat);
                  const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
                  return `${sat.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${sun.toLocaleDateString('en-US', { day: 'numeric' })}`;
                })() },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => handleTimeFilter(t.value)}
                  title={t.desc}
                  className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-all whitespace-nowrap ${
                    discoverTimeFilter === t.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {!discoverLoading && discoverLoaded && filteredDiscoverEvents.length > 0 && (
            <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">📍</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900">
                    {discoverCategory
                      ? `${DISCOVER_CATEGORIES.find(c => c.value === discoverCategory)?.label || 'Events'} in ${city}`
                      : discoverTimeFilter === 'today' ? `Today in ${city}`
                      : discoverTimeFilter === 'tomorrow' ? `Tomorrow in ${city}`
                      : discoverTimeFilter === 'weekend' ? `This Weekend in ${city}`
                      : `Upcoming in ${city}`}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{filteredDiscoverEvents.length}{priceFilter !== 'any' ? ` of ${discoverEvents.length}` : ''}</span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">{filteredDiscoverEvents.map(renderEventCard)}</div>
            </div>
          )}

          {/* Empty */}
          {!discoverLoading && discoverLoaded && filteredDiscoverEvents.length === 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
              <span className="text-4xl">🤷</span>
              <h3 className="mt-3 font-display text-base font-bold text-gray-700">No events found</h3>
              <p className="mt-2 text-sm text-gray-400">
                {priceFilter !== 'any' && discoverEvents.length > 0
                  ? `${discoverEvents.length} events found but none match your price filter.`
                  : city ? `Try a different category or check back later for events near ${city}.` : 'Set your city above to discover local events.'}
              </p>
            </div>
          )}

          {!discoverLoading && !discoverLoaded && !city && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
              <span className="text-4xl">📍</span>
              <h3 className="mt-3 font-display text-base font-bold text-gray-700">Set your city</h3>
              <p className="mt-2 text-sm text-gray-400">
                Enter your city above or set it in <strong>Settings</strong> to browse local events.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ====== SAVED TAB ====== */}
      {tab === 'saved' && (
        <div className="space-y-5">
          {savedEventsList.length > 0 ? (
            <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">❤️</span>
                  <h2 className="font-display text-sm font-semibold text-gray-900">Your Saved Events</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{savedEventsList.length}</span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">{savedEventsList.map(renderEventCard)}</div>
            </div>
          ) : savedEventsLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slotted-400 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-400">Loading saved events…</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10">
              <div className="flex flex-col items-center text-center">
                <span className="text-4xl">❤️</span>
                <h3 className="mt-3 font-display text-base font-bold text-gray-700">No saved events yet</h3>
                <p className="mt-2 max-w-md text-sm text-gray-400 leading-relaxed">
                  Tap the heart icon on any event to save it here. Your saved events stay in one place so you can come back and buy tickets later.
                </p>
                <button
                  onClick={() => setTab('discover')}
                  className="mt-4 rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  🗺️ Discover Events
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====== CALENDAR TAB ====== */}
      {tab === 'calendar' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <button onClick={() => setCalMonthOffset((o) => o - 1)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div className="text-center">
                <button onClick={() => setCalMonthOffset(0)} className="text-sm font-bold text-gray-700 hover:text-slotted-600 transition-colors">
                  {calMonthLabel}
                </button>
                <p className="text-[10px] text-gray-400">Events in {city || 'your area'}</p>
              </div>
              <button onClick={() => setCalMonthOffset((o) => o + 1)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-1.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{d}</p>
                </div>
              ))}
            </div>

            {/* Month grid */}
            {calGrid.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
                {week.map((dateStr) => {
                  const d = new Date(dateStr + 'T12:00:00');
                  const isToday = dateStr === new Date().toLocaleDateString('en-CA');
                  const isCurrentMonth = d.getMonth() === currentMonth;
                  const dayEvents = eventsOnDate(dateStr);
                  return (
                    <div key={dateStr} className={`border-r border-gray-50 last:border-r-0 min-h-[80px] p-1 ${isToday ? 'bg-slotted-50/40' : !isCurrentMonth ? 'bg-gray-50/50' : ''}`}>
                      <p className={`text-[11px] font-semibold text-center mb-0.5 ${
                        isToday ? 'text-white bg-slotted-500 rounded-full w-5 h-5 flex items-center justify-center mx-auto'
                        : isCurrentMonth ? 'text-gray-700' : 'text-gray-300'
                      }`}>
                        {d.getDate()}
                      </p>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <a key={ev.id} href={ev.url} target="_blank" rel="noopener noreferrer"
                            className="block rounded px-1 py-0.5 text-[8px] leading-tight truncate bg-slotted-100/60 text-slotted-700 hover:bg-slotted-200/60 transition-colors"
                            title={`${ev.title} — ${formatDateTime(ev.datetimeLocal || ev.datetime)}\n${ev.venue}`}>
                            {typeEmoji(ev.type)} {ev.title}
                          </a>
                        ))}
                        {dayEvents.length > 2 && (
                          <p className="text-[8px] text-slotted-500 font-semibold text-center">+{dayEvents.length - 2} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-slotted-400" /> Events from SeatGeek, Ticketmaster &amp; more
            </span>
            <span>Click any event for tickets</span>
          </div>

          {/* Loading calendar data */}
          {!discoverLoaded && city && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slotted-300 border-t-transparent" />
              <p className="mt-2 text-xs text-gray-400">Loading events for {city}…</p>
            </div>
          )}

          {!city && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
              <span className="text-3xl">📍</span>
              <p className="mt-2 text-sm text-gray-400">Set your city in Settings to see events on the calendar.</p>
            </div>
          )}
        </div>
      )}

      {/* ====== SHARE MODAL ====== */}
      {shareEvent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !shareSending && setShareEvent(null)}>
          <div
            className="w-full max-w-[calc(100vw-1rem)] sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Event preview */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 bg-gray-50/50">
              {shareEvent.imageUrl ? (
                <img src={shareEvent.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0" loading="lazy" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-lg">
                  {typeEmoji(shareEventType)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{shareEvent.title}</p>
                <p className="text-xs text-gray-500 truncate">
                  {formatDateTime(shareEventDate)}
                  {shareEvent.venue ? ` · ${shareEvent.venue}` : ''}
                </p>
              </div>
              <button
                onClick={() => setShareEvent(null)}
                className="rounded-full p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {shareSent ? (
              /* Sent confirmation */
              <div className="flex flex-col items-center py-10 px-5">
                <span className="text-4xl">✅</span>
                <p className="mt-2 text-sm font-semibold text-gray-900">Sent!</p>
                <p className="text-xs text-gray-400">They'll see it in their notifications</p>
              </div>
            ) : (
              <>
                {/* Friend picker */}
                <div className="px-5 pt-4 pb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Send to</p>
                  {friends.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3">No friends yet — invite friends first!</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                      {friends.map((f) => {
                        const selected = shareFriends.has(f.id);
                        return (
                          <button
                            key={f.id}
                            onClick={() => toggleShareFriend(f.id)}
                            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                              selected
                                ? 'border-slotted-400 bg-slotted-100 text-slotted-700 shadow-sm'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-slotted-200'
                            }`}
                          >
                            {f.photoUrl ? (
                              <img src={f.photoUrl} alt="" className="h-5 w-5 rounded-full" loading="lazy" />
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

                {/* Optional message */}
                <div className="px-5 py-3">
                  <input
                    type="text"
                    value={shareMessage}
                    onChange={(e) => setShareMessage(e.target.value)}
                    placeholder="Add a message (optional)..."
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
                    onKeyDown={(e) => { if (e.key === 'Enter' && shareFriends.size > 0) handleShare(); }}
                  />
                </div>

                {/* Send button */}
                <div className="border-t border-gray-100 px-5 py-4 flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">
                    {shareFriends.size > 0 ? `Sending to ${shareFriends.size} friend${shareFriends.size > 1 ? 's' : ''}` : 'Select friends above'}
                  </p>
                  <button
                    onClick={handleShare}
                    disabled={shareSending || shareFriends.size === 0}
                    className="rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2"
                  >
                    {shareSending ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
