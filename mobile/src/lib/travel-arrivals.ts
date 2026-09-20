/// "Alex, Sam" — the line a day is scanned for when arrivals stagger.
export function whoArrivesLabel(
  arrivals: { name: string | null; username: string | null }[] | undefined | null,
): string | null {
  if (!arrivals?.length) return null;
  return arrivals
    .map((person) => person.name?.trim() || (person.username ? `@${person.username}` : "them"))
    .join(", ");
}
