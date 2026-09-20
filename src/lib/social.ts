import { prisma } from "@/lib/prisma";
import type { PublicTripDTO } from "@/lib/types";
import { itemWithArrivalsInclude, toPublicItineraryItem } from "@/lib/travel-arrivals";

/// What a published trip exposes. Same allow-list discipline as share links:
/// the itinerary and its locations, never the owner's private notes or ratings
/// on the underlying places.
export type FeedTrip = PublicTripDTO & {
  id: string;
  publishedAt: string;
  stopCount: number;
  author: { username: string | null; name: string | null; image: string | null };
  copiedFrom: { username: string | null; title: string } | null;
};

const AUTHOR_SELECT = { username: true, name: true, image: true } as const;

export function toFeedTrip(trip: {
  id: string;
  title: string;
  destination: string | null;
  startDate: Date | null;
  endDate: Date | null;
  color: string;
  destinations?: string[];
  publishedAt: Date | null;
  user: { username: string | null; name: string | null; image: string | null };
  copiedFrom: { title: string; user: { username: string | null } } | null;
  _count: { items: number };
}): FeedTrip {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    destinations: trip.destinations ?? [],
    startDate: trip.startDate?.toISOString() ?? null,
    endDate: trip.endDate?.toISOString() ?? null,
    color: trip.color,
    publishedAt: (trip.publishedAt ?? new Date()).toISOString(),
    stopCount: trip._count.items,
    author: trip.user,
    copiedFrom: trip.copiedFrom
      ? { username: trip.copiedFrom.user.username, title: trip.copiedFrom.title }
      : null,
  };
}

export const feedTripInclude = {
  user: { select: AUTHOR_SELECT },
  copiedFrom: { select: { title: true, user: { select: { username: true } } } },
  _count: { select: { items: true } },
} as const;

/// Real published trips, for somebody whose own feed has nothing in it.
///
/// A new account's feed is empty, and an empty feed teaches people that the
/// social half of this does nothing. The obvious fix is a house account full
/// of invented trips, and the reason not to build one is the copy button:
/// anybody can take one of these into their own account and then actually go.
/// Invented places send somebody to a restaurant that does not exist.
///
/// So these are not examples in the sense of being made up. They are real
/// trips that real people chose to publish, which is what publishing is for,
/// shown to somebody who has nobody to see them from yet. Nothing here is
/// visible that was not already public on a profile and at /t/[id]; the only
/// new thing is the address it is shown at.
///
/// Labelled on screen as not-your-feed, always. A stranger's trip quietly
/// mixed in among the people you chose to follow would be the dishonest
/// version of this.
export async function tripsToStartFrom(viewerId: string, hidden: string[], take = 6) {
  const trips = await prisma.trip.findMany({
    where: {
      publishedAt: { not: null },
      userId: { notIn: [viewerId, ...hidden] },
      user: { username: { not: null } },
    },
    orderBy: { publishedAt: "desc" },
    take,
    include: feedTripInclude,
  });
  return trips.map(toFeedTrip);
}

/// A published trip, readable by anyone. Returns null for private ones so
/// callers answer 404 rather than confirming the trip exists.
export async function loadPublishedTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      ...feedTripInclude,
      items: {
        orderBy: [{ dayIndex: "asc" }, { position: "asc" }],
        include: itemWithArrivalsInclude,
      },
    },
  });
  if (!trip || !trip.publishedAt) return null;

  const items = trip.items.map(toPublicItineraryItem);

  return { trip, items };
}
