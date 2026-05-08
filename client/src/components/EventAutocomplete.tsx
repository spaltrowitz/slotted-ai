import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

export interface AutocompleteEvent {
  id: string;
  title: string;
  venue: string;
  type: string;
}

const TYPE_BADGES: Record<string, string> = {
  theater: '🎭',
  concert: '🎵',
  comedy: '😂',
  sports: '⚽',
  festival: '🎪',
  dance: '💃',
  opera: '🎶',
  musical: '🎭',
};

interface EventAutocompleteProps {
  onSelect: (event: AutocompleteEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function EventAutocomplete({ onSelect, inputRef }: EventAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AutocompleteEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    api
      .get('/events/autocomplete', { params: { q }, signal: controller.signal })
      .then((resp) => {
        const items = Array.isArray(resp.data) ? resp.data : [];
        setResults(items);
        setOpen(items.length > 0);
        setActiveIndex(-1);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        console.error('Event autocomplete failed:', err?.response?.status, err?.message);
        setResults([]);
        setOpen(false);
        setLoading(false);
      });
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (value.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(() => doSearch(value), 400);
  };

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectItem(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const selectItem = (event: AutocompleteEvent) => {
    setQuery(event.title);
    setOpen(false);
    onSelect(event);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onBlur={() => { setTimeout(() => setOpen(false), 200); }}
          placeholder="Search for an event..."
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition-all"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `autocomplete-item-${activeIndex}` : undefined}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          {results.map((event, idx) => (
            <li
              key={event.id}
              id={`autocomplete-item-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={() => selectItem(event)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex items-center gap-3 px-3.5 py-3 min-h-[44px] cursor-pointer transition-colors ${
                idx === activeIndex ? 'bg-violet-50' : 'hover:bg-gray-50'
              }`}
            >
              <span className="text-lg shrink-0">
                {TYPE_BADGES[event.type?.toLowerCase()] ?? '🎫'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                <p className="text-xs text-gray-500 truncate">{event.venue}</p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 capitalize">
                {event.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
