import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { geocode } from "@/lib/geocode";
import { BUILT_IN_CATEGORY_IDS, TRAVEL_MODE_IDS } from "@/lib/taxonomy";
import { dayAfter } from "@/lib/trip-calendar";
import { whoArrivesLabel } from "@/lib/travel-arrivals";

/// Otto, who fills a day.
///
/// The drafting endpoint plans a whole trip from nothing. This is the other
/// half of the same job and the more common one: four days are built, the
/// fifth is empty, and the thing that would help is somebody who can see what
/// is already there. A cold draft guesses; this reads the trip first.
///
/// He proposes and never writes. What comes back is a list of entries in the
/// shape the importer already takes, so the client shows them the same way it
/// shows a pasted itinerary — checkboxes, what was found, confirm or correct —
/// and applies the accepted ones through `/api/trips/import`. Nothing here
/// touches the trip. The rule the drafting code states is the rule here: the
/// human stays between the suggestion and the map.

/// How many times he may call a tool before he has to answer with what he has.
///
/// An agent that cannot finish is a bill with no output. Eight is enough to
/// read the day, look twice, and propose five or six stops; past that he is
/// usually refining something nobody asked him to refine.
const MAX_TURNS = 8;

/// A place as the importer takes it.
export type OttoPlace = {
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
};

/// One proposed row, in the shape `/api/trips/import` already accepts.
export type OttoEntry = {
  kind: "stop" | "travel";
  dayIndex: number;
  title: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  category: string;
  mode: string | null;
  place: OttoPlace | null;
  toPlace: OttoPlace | null;
};

export type OttoResult = {
  entries: OttoEntry[];
  /// What he says about it, in a sentence or two. Shown above the list.
  say: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  turns: number;
};

export const ottoConfigured = Boolean(process.env["ANTHROPIC_API_KEY"]);

const SYSTEM = `You are Otto. You fill in a day of somebody's trip.

You are not a chat assistant and this is not a conversation. You read the day,
find real places, and propose stops. Then you stop.

How you work:

- Read the day first. What is already on it decides everything — where the
  traveller is staying, what they have booked, how far apart things are.
- Prefer places they have already saved. Somebody who starred a café last year
  wants to be reminded of it, not sold a different one.
- Every place you propose must come back from a search. You cannot name a place
  you have not looked up, and a place that does not resolve does not exist.
- Fit around what is there. If there is a booking at ten and dinner at eight,
  you are filling the middle, not rearranging their day.
- Walking distance matters more than a full schedule. Four good stops near each
  other beat seven across a city.
- Leave a gap rather than pad it. If nothing decent is near, say so and propose
  less. A short honest day beats a day with filler in it.

How you write:

- Say what you did, not what you are about to do.
- Name real places. Never "a charming local spot".
- One short line per stop: why it is worth going, or a warning about booking.
- State the limit in the same breath as the offer.
- No emoji. No exclamation marks. Do not apologise twice.

When you have proposed what you can, write one or two sentences about the shape
of the day and finish. Do not ask whether they would like you to continue.`;

/// What the traveller's day looks like, written for the model rather than for
/// a screen. Times, names, cities and coordinates; nothing else, because every
/// line of this is paid for.
function describeDay(
  label: string,
  date: string | null,
  items: {
    kind: string;
    title: string;
    startTime: string | null;
    endTime: string | null;
    minutes: number | null;
    category: string;
    mode: string | null;
    place: { name: string; city: string | null; lat: number; lng: number } | null;
    toPlace: { name: string; city: string | null } | null;
    arrivals?: { user: { name: string | null; username: string | null } }[];
  }[],
) {
  if (items.length === 0) return `${label}${date ? ` (${date})` : ""}: empty`;

  const lines = items.map((item) => {
    const when = item.startTime ?? "any time";
    if (item.kind === "travel") {
      const who = whoArrivesLabel(item.arrivals?.map((a) => a.user));
      return `  ${when} — ${item.place?.name ?? "?"} → ${item.toPlace?.name ?? "?"} by ${item.mode ?? "?"}${who ? ` (${who})` : ""}`;
    }
    const where = item.place
      ? `${item.place.name}${item.place.city ? `, ${item.place.city}` : ""} (${item.place.lat.toFixed(4)},${item.place.lng.toFixed(4)})`
      : item.title;
    const howLong = item.minutes ? `, about ${item.minutes} min` : "";
    return `  ${when} — ${where} [${item.category}]${howLong}`;
  });

  return `${label}${date ? ` (${date})` : ""}:\n${lines.join("\n")}`;
}

export async function runOtto(input: {
  tripId: string;
  /// Whose places may be searched. The trip's owner, not necessarily the
  /// caller — an editor filling a day should be offered the owner's places.
  ownerId: string;
  /// Zero-based, as everything else that counts days here is.
  dayIndex: number;
  /// What they asked for, when they asked for anything. Most of the time this
  /// is empty and the day itself is the whole brief.
  ask?: string | null;
}): Promise<OttoResult> {
  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: { id: true, title: true, startDate: true, destinations: true, destination: true },
  });
  if (!trip) throw new Error("No such trip");

  const items = await prisma.itineraryItem.findMany({
    where: { tripId: input.tripId, dayIndex: { gte: input.dayIndex - 1, lte: input.dayIndex + 1 } },
    orderBy: [{ dayIndex: "asc" }, { position: "asc" }],
    select: {
      kind: true,
      title: true,
      startTime: true,
      endTime: true,
      minutes: true,
      category: true,
      mode: true,
      dayIndex: true,
      place: { select: { name: true, city: true, lat: true, lng: true } },
      toPlace: { select: { name: true, city: true } },
      arrivals: { select: { user: { select: { name: true, username: true } } } },
    },
  });

  const onDay = (d: number) => items.filter((i) => i.dayIndex === d);

  /// Where the day is, so a search can be ranked around it rather than around
  /// the world. The day's own stops first, then its neighbours, then nothing —
  /// an empty day in the middle of an empty trip has no anchor and the model
  /// has to say where it means.
  const anchors = [...onDay(input.dayIndex), ...onDay(input.dayIndex - 1), ...onDay(input.dayIndex + 1)]
    .map((i) => i.place)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const centre = anchors.length > 0 ? { lat: anchors[0]!.lat, lng: anchors[0]!.lng } : null;

  const dateOf = (d: number) =>
    trip.startDate ? dayAfter(trip.startDate.toISOString().slice(0, 10), d) : null;

  /// Places found during this run, so a proposal can point at one instead of
  /// repeating its coordinates back — and so nothing can be proposed that was
  /// never looked up.
  const found = new Map<string, OttoPlace>();
  const staged: OttoEntry[] = [];

  const remember = (key: string, place: OttoPlace) => {
    found.set(key, place);
    return key;
  };

  const readTrip = betaZodTool({
    name: "read_trip",
    description:
      "The day you are filling, with the day either side of it. Call this first. Returns what is already planned, with coordinates.",
    inputSchema: z.object({}),
    run: async () => {
      const where = trip.destinations.length > 0 ? trip.destinations.join(", ") : (trip.destination ?? "somewhere");
      // Days are 0-based here and 1-based to a human, and the day before the
      // first one is left out rather than described as empty — it is not a day
      // of this trip and saying so twice costs tokens to no purpose.
      const parts = [`Trip: ${trip.title} — ${where}`];
      if (input.dayIndex > 0) {
        parts.push(
          describeDay(`Day ${input.dayIndex}`, dateOf(input.dayIndex - 1), onDay(input.dayIndex - 1)),
        );
      }
      parts.push(
        describeDay(
          `Day ${input.dayIndex + 1} — THE ONE TO FILL`,
          dateOf(input.dayIndex),
          onDay(input.dayIndex),
        ),
        describeDay(`Day ${input.dayIndex + 2}`, dateOf(input.dayIndex + 1), onDay(input.dayIndex + 1)),
      );
      return parts.join("\n\n");
    },
  });

  const listSaved = betaZodTool({
    name: "list_saved_places",
    description:
      "Places this traveller has already saved near the day. Prefer these — they chose them once already. Returns a ref you can propose with.",
    inputSchema: z.object({
      category: z.enum(BUILT_IN_CATEGORY_IDS).nullable().optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    run: async ({ category, limit }) => {
      if (!centre) return "The day has nothing on it to search around. Search by name instead.";
      /// A degree of latitude is about 111km; a fifth of one is a comfortable
      /// day's wandering and small enough that the answer is about this city.
      const box = 0.2;
      const places = await prisma.place.findMany({
        where: {
          userId: input.ownerId,
          ...(category ? { category } : {}),
          lat: { gte: centre.lat - box, lte: centre.lat + box },
          lng: { gte: centre.lng - box, lte: centre.lng + box },
        },
        take: limit,
        select: {
          id: true, name: true, category: true, city: true, country: true,
          countryCode: true, address: true, lat: true, lng: true, status: true, notes: true,
        },
      });
      if (places.length === 0) return "Nothing saved near this day.";
      return places
        .map((p) => {
          const ref = remember(`saved:${p.id}`, {
            name: p.name, lat: p.lat, lng: p.lng, address: p.address,
            city: p.city, country: p.country, countryCode: p.countryCode,
          });
          const note = p.notes ? ` — their note: ${p.notes.slice(0, 120)}` : "";
          return `${ref} · ${p.name}${p.city ? `, ${p.city}` : ""} [${p.category}, ${p.status}]${note}`;
        })
        .join("\n");
    },
  });

  const searchPlaces = betaZodTool({
    name: "search_places",
    description:
      "Look a place up on the map. Use the real name as it appears on a map, never a description. Returns refs you can propose with; a place that does not come back does not exist.",
    inputSchema: z.object({
      query: z.string().min(2).max(120),
    }),
    run: async ({ query }) => {
      const results = await geocode(query, trip.destinations.length > 0 ? trip.destinations : null);
      const top = results.slice(0, 5);
      if (top.length === 0) return `Nothing on the map for "${query}".`;
      return top
        .map((r, i) => {
          const ref = remember(`found:${query}:${i}`, {
            name: r.name, lat: r.lat, lng: r.lng, address: r.address ?? null,
            city: r.city ?? null, country: r.country ?? null, countryCode: r.countryCode ?? null,
          });
          return `${ref} · ${r.name}${r.city ? `, ${r.city}` : ""} [${r.category}] ${r.context ?? ""}`.trim();
        })
        .join("\n");
    },
  });

  const proposeStop = betaZodTool({
    name: "propose_stop",
    description:
      "Stage one stop on the day being filled. Nothing is saved — the traveller confirms it afterwards.",
    inputSchema: z.object({
      placeRef: z.string().describe("A ref from search_places or list_saved_places"),
      title: z.string().min(1).max(160),
      category: z.enum(BUILT_IN_CATEGORY_IDS),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      note: z.string().max(200).nullable().optional(),
    }),
    run: async ({ placeRef, title, category, startTime, note }) => {
      const place = found.get(placeRef);
      if (!place) return `No such ref: ${placeRef}. Look the place up first.`;
      staged.push({
        kind: "stop",
        dayIndex: input.dayIndex,
        title,
        startTime: startTime ?? null,
        endTime: null,
        notes: note ?? null,
        category,
        mode: null,
        place,
        toPlace: null,
      });
      return `Staged: ${title}. ${staged.length} so far.`;
    },
  });

  const proposeJourney = betaZodTool({
    name: "propose_journey",
    description:
      "Stage a leg between two places on the day being filled — only when the day genuinely moves between cities.",
    inputSchema: z.object({
      fromRef: z.string(),
      toRef: z.string(),
      title: z.string().min(1).max(160),
      mode: z.enum(TRAVEL_MODE_IDS),
      departs: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      arrives: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      note: z.string().max(200).nullable().optional(),
    }),
    run: async ({ fromRef, toRef, title, mode, departs, arrives, note }) => {
      const from = found.get(fromRef);
      const to = found.get(toRef);
      if (!from || !to) return "One of those refs is unknown. Look both ends up first.";
      staged.push({
        kind: "travel",
        dayIndex: input.dayIndex,
        title,
        startTime: departs ?? null,
        endTime: arrives ?? null,
        notes: note ?? null,
        category: "transport",
        mode,
        place: from,
        toPlace: to,
      });
      return `Staged the journey: ${title}.`;
    },
  });

  const client = new Anthropic();
  const runner = client.beta.messages.toolRunner({
    // Sonnet rather than Opus, at two fifths the price. Finding places near
    // other places and writing a line about each is not frontier reasoning,
    // and the tools do the part that has to be right.
    model: "claude-sonnet-5",
    max_tokens: 8000,
    system: SYSTEM,
    // A tool loop pays for its own history. Every turn resends everything
    // said so far, which is why two thirds of what a day fill costs is input
    // rather than output — the model is billed to re-read its own working.
    //
    // Top-level rather than a marker on a block, because the marker has to
    // move: it lands on the last cacheable block of whatever this turn's
    // request happens to be, so each turn reads the last one's prefix instead
    // of paying for it again. A read is a tenth of the price of fresh input,
    // a write is a quarter more, so this is ahead by the second turn and this
    // loop runs up to eight.
    cache_control: { type: "ephemeral" },
    max_iterations: MAX_TURNS,
    tools: [readTrip, listSaved, searchPlaces, proposeStop, proposeJourney],
    messages: [
      {
        role: "user",
        content: input.ask?.trim()
          ? `Fill day ${input.dayIndex + 1} of this trip. They said: ${input.ask.trim()}`
          : `Fill day ${input.dayIndex + 1} of this trip.`,
      },
    ],
  });

  let inputTokens = 0;
  let outputTokens = 0;
  /// What the cache served instead of charging full price for. Recorded so
  /// the saving is a measurement rather than a belief — if this stays zero,
  /// something in the prefix is changing between turns and the caching is
  /// doing nothing.
  let cachedTokens = 0;
  let turns = 0;
  let say = "";

  for await (const message of runner) {
    turns += 1;
    inputTokens += message.usage?.input_tokens ?? 0;
    outputTokens += message.usage?.output_tokens ?? 0;
    cachedTokens += message.usage?.cache_read_input_tokens ?? 0;
    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
    if (text) say = text;
  }

  return { entries: staged, say, usage: { inputTokens, outputTokens, cachedTokens }, turns };
}
