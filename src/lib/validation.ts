import { z } from "zod";
import { STATUS_IDS, TRAVEL_MODE_IDS } from "@/lib/taxonomy";
import { REPORT_REASON_IDS } from "@/lib/report-reasons";
import { BOOKING_STATES } from "@/lib/bookings";
import { RESOURCE_KIND_IDS } from "@/lib/resources";

/// A category id, which is either one of the built-in words or the cuid of one
/// somebody made. Which of those it is cannot be settled here — it depends on
/// who is asking — so the shape is checked here and the ownership by
/// `resolveCategory` in the route, where the user is known.
const categoryField = z.string().min(1).max(40);


const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

// Fields are declared once with NO defaults, because `.partial()` does not
// strip a `.default()` — a PATCH that omitted `status` would otherwise parse as
// "wishlist" and silently un-visit the place. Create schemas add the defaults
// back on top; update schemas take the bare fields.
/// A single emoji. Deliberately forgiving about length — flags, skin tones and
/// ZWJ sequences are several code points — but it must actually be pictographic
/// and must not be letters or digits, so a pin can never become text.
const emoji = z
  .string()
  .trim()
  .max(16, "That's too long for an emoji")
  // Flags are pairs of regional-indicator characters rather than pictographs,
  // and a travel app that rejects 🇨🇭 would be absurd.
  .refine(
    (v) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(v),
    "Pick an emoji",
  )
  .refine((v) => !/[\p{L}\p{N}]/u.test(v), "Emoji only, no letters or numbers")
  .nullable()
  .optional();

const placeFields = {
  name: trimmed(120).min(1, "Give the place a name"),
  category: categoryField,
  emoji,
  status: z.enum(STATUS_IDS),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: optionalText(300),
  city: optionalText(120),
  country: optionalText(120),
  countryCode: optionalText(8).transform((v) => v?.toLowerCase() ?? null),
  notes: optionalText(2000),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  website: optionalText(500),
  visitedAt: z.coerce.date().nullable().optional(),
  livedFrom: z.coerce.date().nullable().optional(),
  livedTo: z.coerce.date().nullable().optional(),
};

export const placeCreateSchema = z.object(placeFields).extend({
  category: categoryField.default("other"),
  status: z.enum(STATUS_IDS).default("wishlist"),
});

export const placeUpdateSchema = z.object(placeFields).partial();

const tripFields = {
  title: trimmed(120).min(1, "Give the trip a title"),
  destination: optionalText(160),
  /// Capped because this is a hint for a search and a line of text under a
  /// name, not an itinerary — a trip listing thirty is describing its stops.
  destinations: z.array(trimmed(120).min(1)).max(12).optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  notes: optionalText(2000),
  color: trimmed(9).regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex colour"),
};

/// A destination the picker already found, handed back so the server does not
/// have to look the label up again.
///
/// The label is all that gets stored — it is what a trip says it is about, and
/// every screen that shows a trip shows that. These are the coordinates behind
/// it, used once to put the city on the map and then dropped.
///
/// Worth carrying because the round trip through the label loses things. The
/// picker shows "Quebec, Canada" for a city and for the province it is in, and
/// searching that string afterwards answers with the province — a pin five
/// hundred kilometres north of the trip. Anywhere a region and its city share
/// a name has the same problem: New York, Mexico, Panama, Luxembourg.
const destinationPinSchema = z.object({
  /// Exactly as it appears in `destinations`, which is how the two are paired.
  label: trimmed(120).min(1),
  name: trimmed(160).min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  city: optionalText(120),
  country: optionalText(120),
  countryCode: optionalText(8).transform((v) => v?.toLowerCase() ?? null),
  category: categoryField.default("other"),
});

/// Never stored, so it is not among the trip's fields — it is an argument to
/// creating one, spent on the way past.
const destinationPins = z.array(destinationPinSchema).max(12).optional();

export const tripCreateSchema = z.object(tripFields).extend({
  destinationPins,
  color: trimmed(9)
    .regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex colour")
    .default("#12322B"),
});

export const tripUpdateSchema = z.object(tripFields).partial().extend({
  destinationPins,
  /// Publishing puts the trip on your public profile and in your followers'
  /// feeds. Stored as a timestamp, so it also orders the feed.
  published: z.boolean().optional(),
  /// "I was asked about publishing this one and said not now." Recorded so
  /// the offer is made once rather than every time the trip is opened.
  publishAsked: z.boolean().optional(),
});

const itemFields = {
  title: trimmed(160).min(1, "Give the item a title"),
  emoji,
  /// "stop" for somewhere you were, "travel" for a journey between two places.
  kind: z.enum(["stop", "travel"]),
  toPlaceId: optionalText(40),
  mode: z.enum(TRAVEL_MODE_IDS).nullable().optional(),
  endTime: optionalText(5),
  /// Days later that a journey lands. Two is enough for anything short of a
  /// cargo ship; the cap is there so a typo cannot push an arrival into a
  /// different month.
  endDayOffset: z.number().int().min(0).max(3),
  // A stop, not a schedule: minutes, capped at a day.
  minutes: z.number().int().min(5).max(1440).nullable(),
  placeId: optionalText(40),
  notes: optionalText(1000),
  dayIndex: z.number().int().min(0).max(365),
  startTime: optionalText(5),
  category: categoryField,
  position: z.number().int().min(0),
  /// Null clears it: something wrongly marked as a booking should be as easy
  /// to take off the list as it was to put on.
  booking: z.enum(BOOKING_STATES).nullable().optional(),
  bookingRef: optionalText(120),
  /// Coerced from a date string, and nullable: a deadline can be taken off
  /// again once the thing is booked or turns out not to need one.
  bookBy: z.coerce.date().nullable().optional(),
  /// Who is arriving on this travel leg. Empty is fine — tagging is optional,
  /// and a solo trip never needs it. Ids must belong to the owner or an
  /// accepted collaborator; the route checks that once the trip is known.
  arrivalUserIds: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
};

export const itemCreateSchema = z
  .object(itemFields)
  .omit({ position: true })
  .extend({
    dayIndex: z.number().int().min(0).max(365).default(0),
    category: categoryField.default("other"),
    // Everything created before travel legs existed is a stop, and so is
    // anything that does not say otherwise.
    kind: z.enum(["stop", "travel"]).default("stop"),
    // Same day unless somebody says otherwise, which is nearly always.
    endDayOffset: z.number().int().min(0).max(3).default(0),
    minutes: z.number().int().min(5).max(1440).nullable().default(null),
  });

/// A trip's apps, passes and paperwork.
export const resourceCreateSchema = z.object({
  label: trimmed(120).min(1, "Give it a name"),
  url: optionalText(500),
  note: optionalText(500),
  kind: z.enum(RESOURCE_KIND_IDS).default("app"),
});

export const resourceUpdateSchema = resourceCreateSchema
  .extend({ ready: z.boolean(), position: z.number().int().min(0) })
  .partial();

export const itemUpdateSchema = z.object(itemFields).partial();

/// Turns a ZodError into the single short message the UI shows in a toast.
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

/// One resolved line of a pasted itinerary. `place` is null when the entry is
/// something that isn't a location ("Train to Zermatt"), which still belongs on
/// the day but never gets a map pin.
/// Somewhere an imported entry happens, when the map knows it.
const importPlaceSchema = z.object({
  name: trimmed(160).min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: optionalText(300),
  city: optionalText(120),
  country: optionalText(120),
  countryCode: optionalText(8).transform((v) => v?.toLowerCase() ?? null),
});

const importEntrySchema = z.object({
  dayIndex: z.number().int().min(0).max(365),
  title: trimmed(160).min(1),
  startTime: optionalText(5),
  notes: optionalText(1000),
  category: categoryField.default("other"),
  /// "stop" for somewhere you were, "travel" for the journey in between.
  ///
  /// A multi-city itinerary that only imports stops has somebody teleporting
  /// between breakfast in one city and lunch in the next.
  kind: z.enum(["stop", "travel"]).default("stop"),
  /// Travel only: how, and when it lands.
  mode: z.enum(TRAVEL_MODE_IDS).nullable().optional(),
  endTime: optionalText(5),
  /// Travel only: where it arrives. `place` is where it left from.
  toPlace: importPlaceSchema.nullable().optional(),
  place: z
    .object({
      name: trimmed(160).min(1),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      address: optionalText(300),
      city: optionalText(120),
      country: optionalText(120),
      countryCode: optionalText(8).transform((v) => v?.toLowerCase() ?? null),
    })
    .nullable()
    .optional(),
});

export const tripImportSchema = z.object({
  /// The trip to make. Omitted when adding to one that already exists.
  trip: tripCreateSchema.optional(),
  /// An existing trip to append to instead.
  ///
  /// The commonest thing anybody imports is not a trip they have taken — it is
  /// a handful of places off a feed that belong on the trip they are about to
  /// take. Without this, that ends in a second trip with the same name.
  tripId: optionalText(40),
  /// A trip you've already taken: every place it creates is marked visited.
  markVisited: z.boolean().default(true),
  entries: z.array(importEntrySchema).min(1, "Nothing to import").max(300),
});

/// The same entries, with nowhere to put them but the map.
///
/// A list of restaurants somebody keeps in their notes is not a trip, and
/// wrapping one in an invented trip to get it imported would put a thing on
/// the Trips page that never happened.
export const placeImportSchema = z.object({
  /// Whether these are places somebody has been or ones they want to go.
  status: z.enum(STATUS_IDS).default("visited"),
  entries: z.array(importEntrySchema).min(1, "Nothing to import").max(300),
});

/// Addressed to an email (someone who may not have an account yet) or to a
/// Roava username / user id (someone you already follow). Exactly one, so a
/// client never has to know a followed person's email to invite them.
export const collaboratorInviteSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("That doesn't look like an email address"))
      .refine((v) => v.length <= 200, "That email is too long")
      .optional(),
    username: z.string().trim().toLowerCase().min(1, "Which person?").optional(),
    userId: z.string().trim().min(1, "Which person?").optional(),
  })
  .refine((v) => [v.email, v.username, v.userId].filter(Boolean).length >= 1, {
    message: "Who are you inviting?",
  })
  .refine((v) => [v.email, v.username, v.userId].filter(Boolean).length <= 1, {
    message: "Invite with an email or a username, not both",
  });

/// Handles are lowercase, URL-safe and unmistakable in a path like /u/tyler.
/// The reserved list stops someone claiming a name that collides with a route.
const RESERVED_USERNAMES = new Set([
  "admin", "api", "roava", "atlas", "been", "feed", "help", "me", "new", "places",
  "settings", "signin", "signout", "s", "support", "trips", "u", "user", "users",
]);

export const profileSchema = z.object({
  /// Marks the welcome as done, whether it was completed or skipped.
  onboarded: z.boolean().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,30}$/, "Use 3–30 letters, numbers or underscores")
    .refine((v) => !RESERVED_USERNAMES.has(v), "That name is reserved")
    .nullable()
    .optional(),
  bio: optionalText(280),
  /// Where you are based, in your own words — "Lisbon", "Brooklyn", "between
  /// Berlin and Lisbon". Not geocoded and not a place on anybody's map: it is
  /// the line under your name that says where you are answering from.
  homeCity: optionalText(80),
  /// Both short on purpose. These are lines on a profile, not an essay: a
  /// sentence about where you are headed and a sentence about how you travel
  /// tell a reader more than either would at four times the length.
  wantsToGo: optionalText(200),
  travelStyle: optionalText(200),
  /// Whether the places you have been are shown to people who follow you.
  /// What that covers is decided by the reading route rather than here —
  /// visited only, never lived, never wishlist — so this is one bit and the
  /// rules it obeys live in one place.
  sharesVisited: z.boolean().optional(),
});

/// One line about what somebody wants out of a trip. Short on purpose: this
/// is "the Matterhorn museum" or "one proper sit-down dinner", not an essay,
/// and a list of twenty of these has to stay scannable by whoever is building
/// the days from it.
export const wantCreateSchema = z.object({
  label: trimmed(120).min(1, "What would you like to do?"),
});

export const followSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Which person?"),
});


export const memoryCreateSchema = z.object({
  title: optionalText(160),
  // Optional so a photo with no words is still an entry — some things are
  // remembered by looking rather than reading.
  body: trimmed(20000),
  placeId: optionalText(40),
  tripId: optionalText(40),
  happenedOn: z.coerce.date().nullable().optional(),
});

export const memoryUpdateSchema = memoryCreateSchema.partial();

export const reportSchema = z.object({
  reason: z.enum(REPORT_REASON_IDS),
  note: optionalText(1000),
  username: optionalText(40),
  tripId: optionalText(40),
});

export const blockSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Which person?"),
});
