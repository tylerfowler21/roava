import { placeForViewer, toPublicPlace, type ArrivalPersonDTO, type PublicItemDTO } from "@/lib/types";

export type { ArrivalPersonDTO };

export const ARRIVAL_USER = {
  select: { id: true, name: true, image: true, username: true },
} as const;

/// What every itinerary read needs once a travel leg can name who lands.
export const itemWithArrivalsInclude = {
  place: true,
  toPlace: true,
  arrivals: {
    orderBy: { createdAt: "asc" as const },
    include: { user: ARRIVAL_USER },
  },
};

type ArrivalRow = {
  user: { id: string; name: string | null; image: string | null; username: string | null };
};

export function serializeArrivals(arrivals: ArrivalRow[] | undefined | null): ArrivalPersonDTO[] {
  return (arrivals ?? []).map((a) => ({
    userId: a.user.id,
    name: a.user.name,
    image: a.user.image,
    username: a.user.username,
  }));
}

/// "Alex, Sam" — the line a day is scanned for when arrivals stagger.
export function whoArrivesLabel(
  arrivals: { name: string | null; username: string | null }[] | undefined | null,
): string | null {
  if (!arrivals?.length) return null;
  return arrivals
    .map((person) => person.name?.trim() || (person.username ? `@${person.username}` : "them"))
    .join(", ");
}

export function uniqueUserIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function unknownArrivalUsers(ids: string[], allowed: Set<string>): string[] {
  return uniqueUserIds(ids).filter((id) => !allowed.has(id));
}

type ItemRecord = {
  bookBy: { toISOString(): string } | null;
  place: (Parameters<typeof placeForViewer>[0] & { userId: string }) | null;
  toPlace: (Parameters<typeof placeForViewer>[0] & { userId: string }) | null;
  arrivals?: ArrivalRow[];
};

/// Strips the join rows and dates so a client gets the same shape the page
/// already hands TripPlanner — plus `arrivals`, which is names rather than ids
/// stuffed into notes.
export function serializeItineraryItem<T extends ItemRecord>(item: T, viewerId: string) {
  const { arrivals, place, toPlace, bookBy, ...rest } = item;
  return {
    ...rest,
    bookBy: bookBy ? bookBy.toISOString() : null,
    place: place ? placeForViewer(place, viewerId) : null,
    toPlace: toPlace ? placeForViewer(toPlace, viewerId) : null,
    arrivals: serializeArrivals(arrivals),
  };
}

/// The allow-list a shared or published itinerary may show, including who
/// arrives — names and pictures, never invitation emails.
export function toPublicItineraryItem(item: {
  id: string;
  kind: string;
  mode: string | null;
  title: string;
  emoji: string | null;
  notes: string | null;
  dayIndex: number;
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  minutes: number | null;
  category: string;
  position: number;
  arrivals?: ArrivalRow[];
  place: Parameters<typeof toPublicPlace>[0] | null;
  toPlace: Parameters<typeof toPublicPlace>[0] | null;
}): PublicItemDTO {
  return {
    id: item.id,
    kind: item.kind,
    mode: item.mode,
    title: item.title,
    emoji: item.emoji,
    notes: item.notes,
    dayIndex: item.dayIndex,
    startTime: item.startTime,
    endTime: item.endTime,
    endDayOffset: item.endDayOffset,
    minutes: item.minutes,
    category: item.category,
    position: item.position,
    arrivals: serializeArrivals(item.arrivals),
    place: item.place ? toPublicPlace(item.place) : null,
    toPlace: item.toPlace ? toPublicPlace(item.toPlace) : null,
  };
}
