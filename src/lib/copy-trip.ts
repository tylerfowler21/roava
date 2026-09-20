import { prisma } from "@/lib/prisma";

/// Two places within about fifty metres of each other, with the same name, are
/// the same place — so copying somebody's trip does not fill your map with a
/// second Fushimi Inari beside the one you already had.
const SAME_PLACE_DEGREES = 0.0005;

/// Copies someone's trip into your own account.
///
/// The result is a plan, not a memory: the itinerary and its places come
/// across, but the dates do not — they were their dates — and the places land
/// on your wishlist rather than being marked as somewhere you have been.
/// Their notes and ratings on a place stay theirs; you get the location.
/// Who was tagged as arriving on a flight stays behind too — those people
/// are on their trip, not on this copy.
///
/// Who is allowed to do this is the caller's business. A published trip is
/// copyable by anyone who can see the profile; a shared one by anyone holding
/// the link. Both end up here.
export async function copyTripInto(input: {
  sourceTripId: string;
  userId: string;
  /// Which of the source's days to take, by their index in it. Undefined
  /// means all of them, which is what most people want.
  ///
  /// The days that come across are renumbered from the start, so taking days
  /// three and five of somebody's week gives you a two-day trip rather than a
  /// five-day one with holes where their other days were.
  days?: number[];
}) {
  const source = await prisma.trip.findUnique({
    where: { id: input.sourceTripId },
    include: {
      items: {
        orderBy: [{ dayIndex: "asc" }, { position: "asc" }],
        include: { place: true, toPlace: true },
      },
    },
  });
  if (!source) return null;

  const wanted = input.days?.length ? [...new Set(input.days)].sort((a, b) => a - b) : null;
  const items = wanted
    ? source.items.filter((i) => wanted.includes(i.dayIndex))
    : source.items;
  if (items.length === 0) return null;

  /// Their day index to yours.
  const dayFor = (dayIndex: number) =>
    wanted ? wanted.indexOf(dayIndex) : dayIndex;

  return prisma.$transaction(async (tx) => {
    const placeIds = new Map<string, string>();

    // Both ends of a travel leg need copying, not just the origin.
    for (const p of items.flatMap((i) => [i.place, i.toPlace])) {
      if (!p || placeIds.has(p.id)) continue;

      const existing = await tx.place.findFirst({
        where: {
          userId: input.userId,
          name: p.name,
          lat: { gte: p.lat - SAME_PLACE_DEGREES, lte: p.lat + SAME_PLACE_DEGREES },
          lng: { gte: p.lng - SAME_PLACE_DEGREES, lte: p.lng + SAME_PLACE_DEGREES },
        },
        select: { id: true },
      });
      if (existing) {
        placeIds.set(p.id, existing.id);
        continue;
      }

      const copy = await tx.place.create({
        data: {
          userId: input.userId,
          name: p.name,
          category: p.category,
          status: "wishlist",
          lat: p.lat,
          lng: p.lng,
          address: p.address,
          city: p.city,
          country: p.country,
          countryCode: p.countryCode,
        },
      });
      placeIds.set(p.id, copy.id);
    }

    const trip = await tx.trip.create({
      data: {
        userId: input.userId,
        title: source.title,
        destination: source.destination,
        destinations: source.destinations,
        color: source.color,
        copiedFromId: source.id,
        items: {
          create: items.map((item) => ({
            kind: item.kind,
            mode: item.mode,
            title: item.title,
            emoji: item.emoji,
            notes: item.notes,
            dayIndex: dayFor(item.dayIndex),
            startTime: item.startTime,
            endTime: item.endTime,
            // How long a stop takes, and the day a journey lands on. Both were
            // being dropped, so a copied trip arrived with every duration gone
            // and an overnight flight landing the evening it left.
            minutes: item.minutes,
            endDayOffset: item.endDayOffset,
            category: item.category,
            position: item.position,
            placeId: item.placeId ? (placeIds.get(item.placeId) ?? null) : null,
            toPlaceId: item.toPlaceId ? (placeIds.get(item.toPlaceId) ?? null) : null,
          })),
        },
      },
    });

    return { trip, ownerId: source.userId, title: source.title };
  });
}
