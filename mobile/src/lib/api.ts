import { File as LocalFile } from "expo-file-system";
/// The app talks to exactly the same API the website does, with a bearer token
/// where the browser would send a cookie.
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "roava.token";

/// Set per build, and inlined at bundle time — which is the catch.
///
/// A published update is bundled separately from the build it lands on, and it
/// does not inherit the build's environment. Publish one without this set and
/// the app has no address to talk to: not signed out, not offline, just
/// silently unable to reach anything, on somebody's phone, with no way back.
/// That happened.
///
/// So a release falls back to production, which is the only thing a release
/// could sensibly mean. Development still refuses to guess: pointing a debug
/// build at production by accident is how test data ends up in real accounts,
/// and there the variable comes from mobile/.env where somebody chose it.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "" : "https://www.roava.co");

export async function storedToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function storeToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /// Worth distinguishing: the token expired or the account was deleted, and
  /// the only useful response is to sign the person out.
  get isSignedOut() {
    return this.status === 401;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, "EXPO_PUBLIC_API_URL is not set for this build");
  }
  const token = await storedToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    // The API answers errors as JSON, but a proxy or a cold start can return
    // HTML, and parsing that as JSON would report the wrong problem entirely.
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {}
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

/// A local file, in the one shape a multipart upload will accept.
///
/// Expo's fetch replaced the React Native one, and it builds the multipart body
/// itself: a part must be a string, a Blob, or something with `bytes()`.
/// React Native's own `{ uri, name, type }` part is no longer understood, and
/// appending one fails at send time with "Unsupported FormDataPart
/// implementation" — which is what every upload in this app was doing.
///
/// expo-file-system's File is a Blob that reads from a local uri, so the bytes
/// still stream from native rather than through JS. Its own sniffed mime type
/// is used only when the picker did not say, because the picker knows what it
/// handed us and the server checks the type before it stores anything.
export function filePart(uri: string, name?: string | null, type?: string | null) {
  const file = new LocalFile(uri);
  return {
    // A Blob's own members, which is what the body builder reaches for.
    bytes: () => file.bytes(),
    size: file.size,
    name: name ?? file.name,
    type: type ?? file.type,
  } as unknown as Blob;
}

/// Uploads a file. Kept apart from `api` because the body is multipart and the
/// Content-Type header must be set by the runtime, not by us — it carries a
/// boundary marker that has to match the body exactly.
export async function upload<T>(path: string, form: FormData): Promise<T> {
  if (!API_URL) throw new ApiError(0, "EXPO_PUBLIC_API_URL is not set for this build");
  const token = await storedToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

/// PUT a file straight to Vercel Blob with a client token from our API.
///
/// Mirrors `@vercel/blob` 2.8's client `put`: the bytes go to Blob, not through
/// a Function, which is what used to drop a screenshot as "the network
/// connection was lost" while a smaller PDF of the same confirmation arrived.
const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

export async function putClientBlob(
  token: string,
  pathname: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ pathname: string; contentType: string }> {
  const storeId = token.split("_")[3] ?? "";
  const payload = new ArrayBuffer(body.byteLength);
  new Uint8Array(payload).set(body);
  const response = await fetch(`${BLOB_API_URL}/?${new URLSearchParams({ pathname })}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-access": "private",
      "x-content-type": contentType,
      ...(storeId ? { "x-vercel-blob-store-id": storeId } : {}),
    },
    body: payload,
  });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const json = (await response.json()) as { error?: { message?: string } | string };
      if (typeof json?.error === "string") message = json.error;
      else if (typeof json?.error?.message === "string") message = json.error.message;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<{ pathname: string; contentType: string }>;
}

export type Place = {
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
  /// Wikipedia's photograph of the place, and the credit the licence requires
  /// travel with it. Null for most places — it has pictures of landmarks and
  /// not of the bar round the corner.
  photoUrl: string | null;
  photoAttribution: string | null;
  photoSourceUrl: string | null;
  /// Whether this is a photograph you added rather than one Wikipedia had.
  /// Only your own is yours to remove.
  photoUploaded: boolean;
  /// When you were there. Optional, and plenty of places are marked visited
  /// without one — which is why the Been screen counts them regardless and
  /// only the year filter needs this.
  visitedAt: string | null;
  /// Only meaningful for "lived": when you moved there, and when you left.
  livedFrom: string | null;
  livedTo: string | null;
};

/// A place found by the geocoder, before anyone saves it.
export type SearchResult = {
  /// Whether this one is where the caller said they were looking — set only
  /// when a region was given, so a trip screen can show these on their own.
  nearby?: boolean;
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
};

export type Memory = {
  id: string;
  title: string | null;
  body: string;
  happenedOn: string | null;
  createdAt: string;
  place: { id: string; name: string; city: string | null } | null;
  trip: { id: string; title: string } | null;
  photos: { id: string }[];
};

export type FeedTrip = {
  id: string;
  title: string;
  destination: string | null;
  destinations?: string[];
  startDate: string | null;
  endDate: string | null;
  color: string;
  publishedAt: string;
  stopCount: number;
  author: { username: string | null; name: string | null; image: string | null };
};

export type Notification = {
  id: string;
  kind: string;
  tripTitle: string | null;
  tripId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: { name: string | null; username: string | null; image: string | null } | null;
};

/// A place somebody you follow has chosen to show you.
///
/// Narrower than a place of your own by design — no status, no trips, no
/// lived-in dates. What crosses between accounts is what the reading route
/// selects and nothing else; if a field is not here, it does not leave the
/// building.
export type SharedPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  emoji: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  rating: number | null;
  photoUrl: string | null;
  user: { name: string | null; username: string | null; image: string | null };
};

export type Me = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  /// Their own address. Used to leave a trip, where the row to remove is the
  /// one they were invited at.
  email: string | null;
  onboarded: boolean;
  /// Whether the places you have been are shown to people who follow you.
  /// Off until somebody turns it on.
  sharesVisited?: boolean;
  /// Whether Otto's paid half is switched on for this account. The website
  /// decides this per render on the server; the app is told once, on the call
  /// it already makes at launch, so a button is never shown and then taken
  /// away when the route answers 404.
  otto?: boolean;
};

export type Person = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  bio: string | null;
  followers: number;
  publishedTrips: number;
  following: boolean;
};

/// Something to have before you go rather than somewhere to be while there.
/// Something one person on a trip wants to do. Attributed, because an
/// unattributed wish list is a suggestion box.
export type TripWant = {
  id: string;
  label: string;
  userId: string;
  user: { name: string | null; username: string | null; image: string | null };
};

export type TripResource = {
  id: string;
  tripId: string;
  label: string;
  url: string | null;
  note: string | null;
  kind: string;
  ready: boolean;
  position: number;
};

/// A file belonging to a trip — a confirmation, a ticket, an emailed
/// itinerary.
export type TripDocument = {
  id: string;
  tripId: string;
  name: string;
  contentType: string;
  size: number;
  /// The stop it confirms, or null for a file that belongs to the whole trip.
  itemId: string | null;
  createdAt: string;
};

export type ItineraryItem = {
  id: string;
  tripId: string;
  /// "stop" or "travel"
  kind: string;
  placeId: string | null;
  toPlaceId: string | null;
  mode: string | null;
  title: string;
  emoji: string | null;
  notes: string | null;
  dayIndex: number;
  startTime: string | null;
  endTime: string | null;
  /// Days later that a journey lands. A flight east across the Atlantic
  /// leaves at seven and arrives at eight the next morning.
  endDayOffset: number;
  /// What it costs, in the trip currency's smallest unit. Null means nobody
  /// has priced it, which is not the same as free.
  costMinor: number | null;
  /// How long an ordinary stop takes, in minutes. Journeys keep clock times.
  minutes: number | null;
  category: string;
  position: number;
  /// "needed", "booked", or null for the many stops that are not bookings.
  booking: string | null;
  bookingRef: string | null;
  /// When it has to be booked by, as an ISO date, or null for no deadline.
  bookBy: string | null;
  /// Carries emoji and category because the icon for a stop resolves through
  /// them — the stop's own override, then the place's, then the category's.
  /// Without those a saved place would show a different icon on the phone than
  /// on the map it came from.
  place: ItemPlace | null;
  toPlace: ItemPlace | null;
  /// Who is landing on this travel leg. Empty when nobody has been tagged.
  arrivals?: ArrivalPerson[];
};

export type ArrivalPerson = {
  userId: string;
  name: string | null;
  image: string | null;
  username: string | null;
};

type ItemPlace = {
  id: string;
  name: string;
  city: string | null;
  emoji: string | null;
  category: string;
  lat: number;
  lng: number;
  /// Wikipedia's photograph of the place. What a stop shows beside its name,
  /// and what a trip borrows for its cover when nobody has chosen one.
  photoUrl: string | null;
  /// What you wrote about the place itself, on your own map — not about this
  /// stop on this day. Sent only to whoever saved it; a shared trip never
  /// carries it.
  notes: string | null;
};

export type Trip = {
  id: string;
  title: string;
  /// Where to read the photograph chosen for this trip, relative to API_URL,
  /// or null when nobody has chosen one. The blob behind it is private, so
  /// this path is the only way to it and it needs the usual Authorization
  /// header.
  coverUrl: string | null;
  /// What a trip made before it could go to more than one place still says.
  destination: string | null;
  destinations: string[];
  startDate: string | null;
  endDate: string | null;
  color: string;
  /// ISO 4217, for everything priced on this trip.
  currency: string;
  publishedAt: string | null;
  /// When the owner was asked whether to publish it and said no. Only the
  /// finish-line offer reads this; publishing itself never looks at it.
  publishAskedAt: string | null;
};
