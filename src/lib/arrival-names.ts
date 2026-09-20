/// Naming the people who land on a travel leg.
///
/// One function, in a file of its own, because it is the only part of the
/// arrivals work both clients need. The rest of travel-arrivals.ts is Prisma
/// include shapes and server DTOs, which cannot cross — so rather than mirror
/// a file that would not compile in the app, this is the shared half and that
/// is the server half.
///
/// It arrived as two hand copies, identical to the byte and registered with
/// nothing. That is how the document rules drifted three days ago: the code
/// agreed and the comments did not, and the comments are what the next person
/// edits from.

/// "Alex, Sam" — the line a day is scanned for when arrivals stagger.
export function whoArrivesLabel(
  arrivals: { name: string | null; username: string | null }[] | undefined | null,
): string | null {
  if (!arrivals?.length) return null;
  return arrivals
    .map((person) => person.name?.trim() || (person.username ? `@${person.username}` : "them"))
    .join(", ");
}
