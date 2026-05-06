import type { ScheduleShowtime } from './EventSearchModal';

interface EventShowtimeCardProps {
  showtime: ScheduleShowtime;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function formatShowtimeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatShowtimeTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatPrice(price: { min?: number | null; max?: number | null }): string | null {
  const hasMin = price.min != null;
  const hasMax = price.max != null;
  if (hasMin && hasMax) {
    if (price.min === price.max) return `$${price.min}`;
    return `$${price.min}–$${price.max}`;
  }
  if (hasMin) return `$${price.min}`;
  if (hasMax) return `$${price.max}`;
  return null;
}

function getCalendarHint(showtime: ScheduleShowtime): { icon: string; label: string } | null {
  if (showtime.available) return { icon: '✅', label: 'Calendar clear' };
  const hasBusy = showtime.conflicts.some((c) => c.reason === 'busy');
  if (hasBusy) return { icon: '❌', label: 'Conflict on calendar' };
  const hasWarning = showtime.conflicts.length > 0;
  if (hasWarning) return { icon: '⚠️', label: "Couldn't check all calendars" };
  return null;
}

export default function EventShowtimeCard({
  showtime,
  selected,
  onToggle,
  disabled = false,
}: EventShowtimeCardProps) {
  const hint = getCalendarHint(showtime);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3.5 text-left transition-all ${
        selected
          ? 'ring-2 ring-violet-400 border-violet-300 bg-violet-50/60'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
            selected
              ? 'border-violet-500 bg-violet-500'
              : 'border-gray-300 bg-white'
          }`}
        >
          {selected && (
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {formatShowtimeDate(showtime.datetime)} · {formatShowtimeTime(showtime.datetime)}
              </p>
              {showtime.price && formatPrice(showtime.price) && (
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatPrice(showtime.price)}
                </p>
              )}
            </div>

            {/* Calendar hint badge */}
            {hint && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {hint.icon} {hint.label}
              </span>
            )}
          </div>

          {/* Availability summary row */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {showtime.allFree.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700"
              >
                ✅ {name}
              </span>
            ))}
            {showtime.conflicts.map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500"
              >
                {c.reason === 'busy' ? '❌' : '⚠️'} {c.name}
              </span>
            ))}
          </div>

          {/* Ticket link */}
          {showtime.ticketUrl && (
            <a
              href={showtime.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 min-h-[44px] text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 hover:border-gray-300"
            >
              🎟️ Tickets
            </a>
          )}
        </div>
      </div>
    </button>
  );
}
