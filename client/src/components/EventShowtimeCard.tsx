import type { ScheduleShowtime } from './EventSearchModal';

interface EventShowtimeCardProps {
  showtime: ScheduleShowtime;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
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
  switch (showtime.availabilityState) {
    case 'all_clear':
      return { icon: '✅', label: 'Everyone looks free' };
    case 'some_busy':
      return { icon: '❌', label: 'Conflict for someone' };
    case 'check_incomplete':
      return { icon: '⚠️', label: "Couldn't check all calendars" };
    default:
      return null;
  }
}

export default function EventShowtimeCard({
  showtime,
  selected,
  onToggle,
  disabled = false,
  onRemove,
  removeDisabled = false,
}: EventShowtimeCardProps) {
  const hint = getCalendarHint(showtime);

  return (
    <div
      className={`w-full rounded-xl border p-3.5 text-left transition-all ${
        selected
          ? 'ring-2 ring-violet-400 border-violet-300 bg-violet-50/60'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-not-allowed"
        >
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
          <div className="min-w-0 flex-1">
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

            {/* Privacy: no per-name availability row. The hint badge above is
                an aggregate; we never name which specific friend is busy or
                hasn't synced. */}


          </div>
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removeDisabled}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-red-100 bg-red-50 text-lg font-semibold leading-none text-red-500 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Remove ${formatShowtimeDate(showtime.datetime)} ${formatShowtimeTime(showtime.datetime)}`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
