/// Serialised shapes handed from server components to client components.
/// Dates become ISO strings so the boundary stays boring and JSON-safe.

export type PlaceDTO = {
  id: string;
  name: string;
  category: string;
  emoji: string | null;
  status: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  notes: string | null;
  rating: number | null;
  /// A Wikipedia photograph of the place, with the credit it has to carry.
  photoUrl: string | null;
  photoAttribution: string | null;
  photoSourceUrl: string | null;
  /// Whether the photograph is one the owner uploaded rather than one
  /// Wikipedia had. The editor offers to remove only their own.
  photoUploaded: boolean;
  /// Whether anyone has gone looking yet. A place can be checked and still
  /// have no photo — most bars are — so this is not `photoUrl !== null`, and
  /// without it the map would ask Wikipedia about the same empty places on
  /// every single load.
  photoChecked: boolean;
  website: string | null;
  visitedAt: string | null;
  livedFrom: string | null;
  livedTo: string | null;
  createdAt: string;
};

export type TripDTO = {
  id: string;
  title: string;
  destination: string | null;
  destinations: string[];
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  color: string;
  /// Where to read the cover photograph, or null when nobody chose one. A
  /// path rather than the blob's own address: the blob is private and this
  /// route is the only way in.
  coverUrl: string | null;
  /// ISO timestamp when the owner published it, or null while private.
  publishedAt: string | null;
  /// When the owner was asked whether to publish it and said no. Only the
  /// finish-line offer reads this.
  publishAskedAt: string | null;
};

/// Something one person on a trip wants to do. Attributed, because an
/// unattributed wish list is a suggestion box.
export type TripWantDTO = {
  id: string;
  label: string;
  userId: string;
  user: { name: string | null; username: string | null; image: string | null };
};

export type ItineraryItemDTO = {
  id: string;
  tripId: string;
  /// "stop" or "travel"
  kind: string;
  placeId: string | null;
  /// Where a travel leg ends
  toPlaceId: string | null;
  mode: string | null;
  title: string;
  emoji: string | null;
  notes: string | null;
  dayIndex: number;
  /// Departure, for a travel leg
  startTime: string | null;
  /// Arrival, for a travel leg
  endTime: string | null;
  /// Days later that a travel leg lands. 0 for everything that arrives the
  /// day it left, which is nearly everything.
  endDayOffset: number;
  /// How long an ordinary stop takes, in minutes. Travel legs keep their
  /// clock times instead; nobody plans a museum to the quarter hour.
  minutes: number | null;
  category: string;
  position: number;
  /// "needed", "booked", or null for the great majority of stops that are not
  /// bookings at all.
  booking: string | null;
  bookingRef: string | null;
  /// When it has to be booked by, as an ISO date, or null for no deadline.
  bookBy: string | null;
  place: PlaceDTO | null;
  toPlace: PlaceDTO | null;
  /// Who is landing on this travel leg. Empty for stops, solo trips, and
  /// legs nobody has tagged — tagging is optional.
  arrivals: ArrivalPersonDTO[];
};

/// A person tagged as arriving on a travel leg. Name and picture only: the
/// itinerary is not the place to show invitation emails.
export type ArrivalPersonDTO = {
  userId: string;
  name: string | null;
  image: string | null;
  username: string | null;
};

/// A file belonging to a trip — a confirmation, a ticket, an emailed
/// itinerary. `createdAt` is an ISO string, as everywhere else a date crosses
/// the wire.
export type TripDocumentDTO = {
  id: string;
  tripId: string;
  name: string;
  contentType: string;
  size: number;
  /// The stop it confirms, or null for a file that belongs to the whole trip.
  itemId: string | null;
  createdAt: string;
};

/// Something to have before you go rather than somewhere to be while you are
/// there — an app, a pass, a document, a link.
export type TripResourceDTO = {
  id: string;
  tripId: string;
  label: string;
  url: string | null;
  note: string | null;
  kind: string;
  ready: boolean;
  position: number;
};

/// A place as returned by the geocode proxy, before it is saved.
export type SearchResult = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  category: string;
  context: string;
  /// Whether this one is where the caller said they were looking — set only
  /// when a region was given. The ranking already puts these first; saying so
  /// lets the trip screens show them on their own and fold the rest away,
  /// which is the difference between "here are five Time Out Markets" and
  /// "here is the one in Lisbon".
  nearby?: boolean;
};

type DateLike = { toISOString(): string };

export function serializePlace<
  T extends {
    visitedAt: DateLike | null;
    livedFrom?: DateLike | null;
    livedTo?: DateLike | null;
    createdAt: DateLike;
  },
>(p: T): PlaceDTO {
  // Where the blob lives is the server's business; what a client needs is
  // whether this picture is the owner's to replace.
  const { photoPathname, ...rest } = p as T & { photoPathname?: string | null };

  return {
    ...(rest as unknown as PlaceDTO),
    photoUploaded: Boolean(photoPathname),
    photoChecked: Boolean((p as { photoCheckedAt?: DateLike | null }).photoCheckedAt),
    visitedAt: p.visitedAt ? p.visitedAt.toISOString() : null,
    livedFrom: p.livedFrom ? p.livedFrom.toISOString() : null,
    livedTo: p.livedTo ? p.livedTo.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializeTrip<
  T extends {
    id: string;
    startDate: DateLike | null;
    endDate: DateLike | null;
    publishedAt?: DateLike | null;
    publishAskedAt?: DateLike | null;
    coverPathname?: string | null;
  },
>(t: T): TripDTO {
  // The pathname is deliberately dropped rather than passed through. It is
  // where the blob lives, and the blob is private; what a client needs is the
  // route that will check whether they may read it.
  const { coverPathname, coverType, ...rest } = t as T & { coverType?: string | null };
  void coverType;

  return {
    ...(rest as unknown as TripDTO),
    startDate: t.startDate ? t.startDate.toISOString() : null,
    endDate: t.endDate ? t.endDate.toISOString() : null,
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
    publishAskedAt: t.publishAskedAt ? t.publishAskedAt.toISOString() : null,
    coverUrl: coverPathname ? `/api/trips/${t.id}/cover` : null,
  };
}

/// A place that has been located but not yet saved — either picked from search
/// or dropped as a pin on the map.
export type PlaceDraft = {
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  category: string;
};

/// A place on a trip, as whoever is looking at the trip may see it.
///
/// Editors on a shared trip see the owner's places, but the notes, rating and
/// dates on a place belong to the person who saved it, not to the trip. Their
/// own places come through whole.
export function placeForViewer<
  T extends Parameters<typeof serializePlace>[0] & { userId: string },
>(p: T, viewerId: string): PlaceDTO {
  const dto = serializePlace(p);
  if (p.userId === viewerId) return dto;
  return { ...dto, notes: null, rating: null, visitedAt: null, livedFrom: null, livedTo: null };
}

// --- public (shared-link) shapes -----------------------------------------
//
// A shared itinerary is readable by anyone holding the link, so these types
// are an explicit allow-list rather than a copy of the private DTOs. Notably
// absent: a place's personal notes and rating, which belong to the owner's
// library rather than to the trip they were used in.

export type PublicPlaceDTO = {
  id: string;
  name: string;
  category: string;
  emoji: string | null;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  /// Wikipedia's photograph of the place. Safe to show a stranger — it is a
  /// picture of a public landmark, not anything the person who saved it made
  /// — and the credit travels with it because the licence requires it.
  photoUrl: string | null;
  photoAttribution: string | null;
  photoSourceUrl: string | null;
};

export type PublicItemDTO = {
  id: string;
  kind: string;
  mode: string | null;
  title: string;
  emoji: string | null;
  notes: string | null;
  dayIndex: number;
  startTime: string | null;
  endTime: string | null;
  /// Days later that a journey lands, so a reader sees the "+1" on an
  /// overnight flight rather than an arrival before its departure.
  endDayOffset: number;
  /// How long an ordinary stop takes, in minutes. Travel legs keep their
  /// clock times instead; nobody plans a museum to the quarter hour.
  minutes: number | null;
  category: string;
  position: number;
  place: PublicPlaceDTO | null;
  toPlace: PublicPlaceDTO | null;
  /// Who lands on this leg, when the owner tagged them. Names rather than
  /// emails — a shared itinerary is often sent to the same people who are on
  /// the flights.
  arrivals: ArrivalPersonDTO[];
};

export type PublicTripDTO = {
  title: string;
  destination: string | null;
  destinations?: string[];
  startDate: string | null;
  endDate: string | null;
  color: string;
  /// The owner's one-line description of the trip, if they wrote one.
  notes?: string | null;
};

export function toPublicPlace(p: {
  id: string;
  name: string;
  category: string;
  emoji: string | null;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  photoUrl?: string | null;
  photoAttribution?: string | null;
  photoSourceUrl?: string | null;
}): PublicPlaceDTO {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    emoji: p.emoji,
    lat: p.lat,
    lng: p.lng,
    city: p.city,
    country: p.country,
    countryCode: p.countryCode,
    photoUrl: p.photoUrl ?? null,
    photoAttribution: p.photoAttribution ?? null,
    photoSourceUrl: p.photoSourceUrl ?? null,
  };
}


export type MemoryDTO = {
  id: string;
  title: string | null;
  body: string;
  happenedOn: string | null;
  createdAt: string;
  placeId: string | null;
  tripId: string | null;
  place: { id: string; name: string; city: string | null; country: string | null } | null;
  trip: { id: string; title: string } | null;
  photos: { id: string }[];
};
