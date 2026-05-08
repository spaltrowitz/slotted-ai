export function getFirstName(displayName: string | null | undefined): string {
  if (!displayName) return '';
  return displayName.split(' ')[0];
}

/**
 * Returns a disambiguated display name. If multiple people in `allNames`
 * share the same first name, appends the last initial (e.g. "Mike S.").
 * Otherwise returns just the first name.
 */
export function getSmartDisplayName(
  displayName: string | null | undefined,
  allNames: (string | null | undefined)[],
): string {
  if (!displayName) return '';
  const parts = displayName.trim().split(/\s+/);
  const firstName = parts[0];

  const hasDuplicate = allNames.some((name) => {
    if (!name || name === displayName) return false;
    return name.trim().split(/\s+/)[0] === firstName;
  });

  if (hasDuplicate && parts.length > 1) {
    const lastInitial = parts[parts.length - 1][0];
    return `${firstName} ${lastInitial.toUpperCase()}.`;
  }

  return firstName;
}

export function timeAgo(dateStr: string): string {
  const normalized = dateStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
    ? dateStr
    : dateStr + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  return `${months} months ago`;
}

export function formatMeetupTime(start: string): string {
  const d = new Date(start);
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  );
}
