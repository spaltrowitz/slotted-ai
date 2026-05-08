import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';

export const NOTIFICATION_TYPE_CONFIG: Record<string, { emoji: string; bg: string; border: string }> = {
  friend_accepted: { emoji: '', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  friend_request: { emoji: '', bg: 'bg-violet-50', border: 'border-violet-100' },
  meetup_request: { emoji: '', bg: 'bg-amber-50', border: 'border-amber-100' },
  meetup_confirmed: { emoji: '✅', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  meetup_reminder: { emoji: '⏳', bg: 'bg-blue-50', border: 'border-blue-100' },
  calendar_match: { emoji: '', bg: 'bg-amber-50', border: 'border-amber-100' },
  event_shared: { emoji: '', bg: 'bg-purple-50', border: 'border-purple-100' },
  meetup_rsvp_changed: { emoji: '', bg: 'bg-sky-50', border: 'border-sky-100' },
  meetup_time_changed: { emoji: '', bg: 'bg-indigo-50', border: 'border-indigo-100' },
  meetup_counter_propose: { emoji: '', bg: 'bg-violet-50', border: 'border-violet-100' },
};

export function parseSharedEvent(body: string) {
  if (!body.startsWith('[EVENT_SHARE]')) return null;
  try {
    return JSON.parse(body.replace('[EVENT_SHARE]', ''));
  } catch { return null; }
}

export function NotificationBody({ text }: { text: string }) {
  const linkMap: [RegExp, string][] = [
    [/Friends tab/gi, '/dashboard'],
    [/Settings/gi, '/settings'],
    [/Events tab/gi, '/events'],
    [/Dashboard/gi, '/'],
  ];

  const parts: (string | ReactElement)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliest: { index: number; length: number; to: string; match: string } | null = null;

    for (const [regex, to] of linkMap) {
      regex.lastIndex = 0;
      const m = regex.exec(remaining);
      if (m && (!earliest || m.index < earliest.index)) {
        earliest = { index: m.index, length: m[0].length, to, match: m[0] };
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index));
    }

    parts.push(
      <Link
        key={key++}
        to={earliest.to}
        className="font-semibold text-slotted-600 underline underline-offset-2 hover:text-slotted-700"
        onClick={(e) => e.stopPropagation()}
      >
        {earliest.match}
      </Link>
    );

    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return <>{parts}</>;
}
