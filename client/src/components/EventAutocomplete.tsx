import { useEffect, useState } from 'react';
import type { Ref } from 'react';
import api from '../lib/api';

export interface AutocompleteEvent {
  id: string;
  title: string;
  venue: string;
  type?: string;
}

interface EventAutocompleteProps {
  onSelect: (event: AutocompleteEvent) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export default function EventAutocomplete({ onSelect, inputRef }: EventAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get<AutocompleteEvent[]>('/events/autocomplete', {
          params: { q },
          signal: controller.signal,
        });
        setSuggestions(data);
        setOpen(true);
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          console.error('Event autocomplete failed:', err);
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (event: AutocompleteEvent) => {
    setQuery(event.title);
    setOpen(false);
    onSelect(event);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search concerts, theater, sports…"
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-base text-gray-900 placeholder:text-gray-400 transition-all focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 sm:text-sm"
      />

      {open && (query.trim().length >= 2 || loading) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
          {loading ? (
            <div className="flex items-center gap-2 px-3.5 py-3 text-sm text-gray-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
              Searching events…
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((event) => (
              <button
                key={event.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(event)}
                className="flex w-full min-w-0 flex-col border-b border-gray-100 px-3.5 py-3 text-left last:border-b-0 hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
              >
                <span className="truncate text-sm font-semibold text-gray-900">{event.title}</span>
                <span className="truncate text-xs text-gray-500">
                  {[event.venue, event.type].filter(Boolean).join(' · ') || 'Event'}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3.5 py-3 text-sm text-gray-500">No matching events found.</div>
          )}
        </div>
      )}
    </div>
  );
}
