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
