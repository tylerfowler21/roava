"use client";

import { useCategories } from "@/components/CategoriesProvider";
import PlaceThumb from "@/components/PlaceThumb";
import { tripWhere, tripRegions, destinationWords, goesTo } from "@/lib/trip-where";

import { PAINT } from "@/lib/brand";
import { usePlaceSearch } from "@/lib/use-place-search";
import { tripRegion } from "@/lib/place-groups";
import { currentPosition, nearbyPlaces, HERE_MESSAGES } from "@/lib/here";
import { enrichSelectedPlace } from "@/lib/enrich-place";
import {
  DURATIONS,
  durationOf,
  formatDuration,
  parseDuration,
  takesTime,
  timingLabel,
} from "@/lib/duration";
import { searchPlaces } from "@/lib/search-places";
import Link from "next/link";
import { useMemo, useState, useRef } from "react";
import MapCanvas, { type MapPin } from "@/components/MapCanvas";
import type { SelectedPlace } from "@/components/map-types";
import EmojiField from "@/components/EmojiField";
import ShareTrip from "@/components/ShareTrip";
import TripPeople from "@/components/TripPeople";
import TripSettings from "@/components/TripSettings";
import TripBookings from "@/components/TripBookings";
import PlaceChooser from "@/components/PlaceChooser";
import TripResources from "@/components/TripResources";
import TripPacking from "@/components/TripPacking";
import TripWants from "@/components/TripWants";
import CostField from "@/components/CostField";
import { anyPriced, formatMoney, totalOf } from "@/lib/money";
import TripFiles from "@/components/TripFiles";
import AddFromLink from "@/components/AddFromLink";
import AskOtto from "@/components/AskOtto";
import OttoSays from "@/components/OttoSays";
import { useTripWeather } from "@/lib/use-trip-weather";
import { condition, weatherSegments } from "@/lib/weather";
import { BOOKING_BOOKED, BOOKING_NEEDED, nextState, outstanding } from "@/lib/bookings";
import { deadlineLabel, urgencyOf } from "@/lib/booking-deadline";
import { TRAVEL_MODES, travelMode, unfiled } from "@/lib/taxonomy";
import { isPacking } from "@/lib/resources";
import { dateForDay, dayCount, durationLabel, formatDay, formatRange } from "@/lib/trips";
import { directionsUrl } from "@/lib/directions";
import type {
  ItineraryItemDTO,
  TripWantDTO,
  PlaceDTO,
  TripDTO,
  TripResourceDTO,
  TripDocumentDTO,
  SearchResult,
} from "@/lib/types";
import DirectionsIcon from "@/components/DirectionsIcon";
import PublishPrompt from "@/components/PublishPrompt";
import type { TripRole } from "@/lib/trip-access";
import type { Collaborator } from "@/components/TripPeople";
import WhoArrives, { type PartyPerson } from "@/components/WhoArrives";
import { whoArrivesLabel } from "@/lib/travel-arrivals";
import {
  DOCUMENT_TYPE_ERROR,
  MAX_DOCUMENT_BYTES,
  documentTooLargeError,
  errorFromUploadResponse,
  resolveDocumentType,
} from "@/lib/trip-documents";
import { prepareDocumentFile } from "@/lib/prepare-document";

export default function TripPlanner({
  otto = false,
  trip: initialTrip,
  initialItems,
  places,
  role,
  ownerId,
  viewerId,
  ownerLabel,
  ownerImage,
  people,
  resources,
  wants,
  me,
  documents,
}: {
  /// Whether Otto is around to explain an empty trip. Decided on the server.
  otto?: boolean;
  trip: TripDTO;
  initialItems: ItineraryItemDTO[];
  places: PlaceDTO[];
  resources: TripResourceDTO[];
  wants: TripWantDTO[];
  /// The current user's id, so the wants list knows which rows are theirs.
  me: string;
  documents: TripDocumentDTO[];
  role: TripRole;
  ownerId: string;
  viewerId: string;
  ownerLabel: string;
  ownerImage: string | null;
  people: Collaborator[];
}) {
  const { categories, categoryOf, stopIconOf } = useCategories();
  // The trip is editable in place (title, dates, colour), so it lives in state
  // rather than being read straight from props.
  const [trip, setTrip] = useState(initialTrip);
  const [items, setItems] = useState(initialItems);
  const [activeDay, setActiveDay] = useState(0);
  /// Which of the trip's three lists is showing. Days is the trip as it will
  /// happen; the other two are the trip as it has to be prepared for.
  const [view, setView] = useState<"days" | "bookings" | "before" | "files">("days");
  const [extraDays, setExtraDays] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /// Which stop has its details open. One at a time, like the selection: two
  /// open cards in a day is the wall this was meant to take apart.
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /// What to narrow the search to: what the trip says it is, or failing that
  /// what its stops say it is. The destination field is optional and most
  /// trips are made without one, so relying on it alone means the narrowing
  /// does not happen for most trips.
  const searchRegion = useMemo(
    () =>
      (tripRegions(trip).length > 0 ? tripRegions(trip) : null) ??
      // Nothing said, so the stops themselves are asked where this trip is.
      [tripRegion(items.map((i) => i.place).filter((p) => p !== null))].filter(
        (r): r is string => r !== null,
      ),
    [trip, items],
  );

  const [dropMode, setDropMode] = useState(false);
  /// The map shows one day at a time by default; "Whole trip" shows the
  /// route across every day.
  const [wholeTrip, setWholeTrip] = useState(false);
  /// A place Apple labelled that has been tapped, waiting to be confirmed.
  ///
  /// Confirmed rather than added outright: the map is also how you pan and
  /// zoom, and a stop that appears because a finger brushed a café is a worse
  /// failure than one tap more.
  const [tapped, setTapped] = useState<SelectedPlace | null>(null);
  // Which stop's emoji picker is open. Separate from selectedId so changing an
  // emoji doesn't also expand the notes panel.
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Places saved from inside the trip go into the library too, so they are
  // available on the map and on every future trip.
  const [library, setLibrary] = useState(places);
  /// Held here rather than inside the files panel, because the same list is
  /// read in two places — attached to a stop, and gathered on its own tab —
  /// and uploading in one must show in the other without a reload.
  const [files, setFiles] = useState(documents);

  const party = useMemo<PartyPerson[]>(() => {
    const you = (id: string, fallback: string) => (id === viewerId ? "You" : fallback);
    const list: PartyPerson[] = [
      { userId: ownerId, name: you(ownerId, ownerLabel), image: ownerImage },
    ];
    for (const person of people) {
      if (!person.accepted || !person.userId || person.userId === ownerId) continue;
      list.push({
        userId: person.userId,
        name: you(
          person.userId,
          person.name ?? (person.username ? `@${person.username}` : person.email),
        ),
        image: person.image,
      });
    }
    return list;
  }, [ownerId, ownerLabel, ownerImage, viewerId, people]);

  const days = dayCount(trip, items) + extraDays;
  const dayItems = useMemo(
    () =>
      items
        .filter((i) => i.dayIndex === activeDay)
        .sort((a, b) => a.position - b.position),
    [items, activeDay],
  );

  /// The place search behind "Add a stop".
  ///
  /// It lives here rather than inside that control because the map has to draw
  /// what it finds. A list of four identically-named Dubais says nothing about
  /// which is which; four numbered pins on the map says it at a glance, which
  /// is the same trick the app's map tab already plays.
  const [query, setQuery] = useState("");
  const [around, setAround] = useState<SearchResult[] | null>(null);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const { results: worldResults } = usePlaceSearch(query.trim(), (q, mode) =>
    searchPlaces(q, mode, searchRegion),
  );

  /// Split by whether the result is where this trip is. Everywhere else is
  /// kept — a trip to Lisbon can still have a day in Sintra, and the gazetteer
  /// does not always agree about which country a place is in — but it does not
  /// get to lead.
  const here = worldResults.filter((r) => r.nearby);
  const elsewhere = worldResults.filter((r) => !r.nearby);
  const shownResults =
    searchRegion.length > 0 && here.length > 0 && !showElsewhere ? here : worldResults;

  /// Whatever the list is offering at this moment: what is around you if you
  /// asked, otherwise what the search turned up.
  const found = around ?? shownResults;

    const pins = useMemo<MapPin[]>(() => {
    const onThisDay = new Map(dayItems.map((item, index) => [item.id, index + 1]));

    const legEnds = items
      .filter((i) => i.kind === "travel" && i.toPlace)
      .map((i) => {
        const meta = travelMode(i.mode);
        return {
          id: `${i.id}-to`,
          lat: i.toPlace!.lat,
          lng: i.toPlace!.lng,
          color: trip.color,
          icon: meta.icon,
          badge: null,
          muted: !wholeTrip && !dayItems.some((d) => d.id === i.id),
        };
      });

    return items
      .filter((item) => item.place)
      .map((item) => {
        const meta = categoryOf(item.category);
        const badge = onThisDay.get(item.id);
        return {
          id: item.id,
          lat: item.place!.lat,
          lng: item.place!.lng,
          color: badge ? trip.color : meta.color,
          icon: stopIconOf(item),
          badge: badge ? String(badge) : null,
          muted: !wholeTrip && !badge,
        };
      })
      .concat(legEnds)
      // What the search turned up, numbered to match the rows under it. Four
      // results all called Dubai are four identical lines until the map says
      // which is which — so they carry Sun rather than a category colour, and
      // the itinerary behind them goes quiet while they are up.
      .map((pin) => ({ ...pin, muted: pin.muted || found.length > 0 }))
      .concat(
        found.map((r, i) => ({
          id: `found-${r.id}`,
          lat: r.lat,
          lng: r.lng,
          color: PAINT.sun,
          icon: unfiled(r.category, categories).icon,
          badge: String(i + 1),
          muted: false,
        })),
      );
  }, [items, dayItems, trip.color, categoryOf, stopIconOf, wholeTrip, found, categories]);

  /// Re-frames the map when a search answers, so the candidates are on screen
  /// rather than wherever the trip happened to be looking.
  const foundToken = found.map((r) => r.id).join(",");

  /// The stops the map draws a line through: today's, or the whole trip's.
  const routeItems = useMemo(
    () =>
      wholeTrip
        ? [...items].sort((a, b) => a.dayIndex - b.dayIndex || a.position - b.position)
        : dayItems,
    [wholeTrip, items, dayItems],
  );

  const legs = useMemo(
    () =>
      routeItems
        .filter((i) => i.kind === "travel" && i.place && i.toPlace)
        .map((i) => ({
          from: [i.place!.lng, i.place!.lat] as [number, number],
          to: [i.toPlace!.lng, i.toPlace!.lat] as [number, number],
        })),
    [routeItems],
  );

  const route = useMemo<[number, number][]>(
    () =>
      routeItems
        .filter((i) => i.place)
        .map((i) => [i.place!.lng, i.place!.lat] as [number, number]),
    [routeItems],
  );

  async function mutate<T>(
    run: () => Promise<Response>,
    apply: (body: T) => void,
    failure: string,
  ) {
    setBusy(true);
    setError(null);
    const res = await run();
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? failure);
      return false;
    }
    apply(body as T);
    return true;
  }

  /// Dragging a row, from whichever part of it somebody grabbed.
  ///
  /// The pointer is captured on the element that was pressed, so every later
  /// move arrives here even once it has left that little circle — and
  /// `touch-none` on both keeps the page from scrolling under the finger.
  function dragHandlers(index: number) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (busy) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        measureRows();
        draggingFrom.current = index;
        setDragOver(index);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (draggingFrom.current === null) return;
        const over = rowAt(e.clientY);
        if (over !== null && over !== dragOver) setDragOver(over);
      },
      onPointerUp: async () => {
        const from = draggingFrom.current;
        const to = dragOver;
        draggingFrom.current = null;
        setDragOver(null);
        if (from !== null && to !== null) await moveTo(from, to);
      },
      onPointerCancel: () => {
        draggingFrom.current = null;
        setDragOver(null);
      },
    };
  }

  function addItem(payload: {
    title: string;
    placeId?: string | null;
    category?: string;
    kind?: "stop" | "travel";
    toPlaceId?: string | null;
    mode?: string;
    startTime?: string | null;
    endTime?: string | null;
    minutes?: number | null;
    endDayOffset?: number;
    arrivalUserIds?: string[];
  }) {
    return mutate<{ item: ItineraryItemDTO }>(
      () =>
        fetch(`/api/trips/${trip.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, dayIndex: activeDay }),
        }),
      (body) => setItems((prev) => [...prev, body.item]),
      "Could not add that stop",
    );
  }

  /// Saves somewhere new to the user's places and adds it to the current day.
  /// Saves a searched place into the library and hands it back.
  ///
  /// Split out from `addNewPlace` because a journey needs a place without a
  /// stop: picking "Zermatt" as where a train arrives should not also put
  /// Zermatt on the day as somewhere you went.
  async function savePlace(input: {
    name: string;
    lat: number;
    lng: number;
    address: string | null;
    city: string | null;
    country: string | null;
    countryCode: string | null;
    category: string;
  }): Promise<PlaceDTO | null> {
    setBusy(true);
    setError(null);

    // A trip that has already finished is a log, so anything added to it has
    // been visited; a trip still ahead is a plan, so it goes on the wishlist.
    // Read at click time — the clock is not something to consult during render.
    const alreadyHappened = trip.endDate ? Date.parse(trip.endDate) < Date.now() : false;

    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        category: input.category,
        status: alreadyHappened ? "visited" : "wishlist",
        lat: input.lat,
        lng: input.lng,
        address: input.address,
        city: input.city,
        country: input.country,
        countryCode: input.countryCode,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not save that place");
      return null;
    }

    const place: PlaceDTO = body.place;
    setLibrary((prev) => [place, ...prev]);
    return place;
  }

  async function addNewPlace(input: {
    name: string;
    lat: number;
    lng: number;
    address: string | null;
    city: string | null;
    country: string | null;
    countryCode: string | null;
    category: string;
  }) {
    const place = await savePlace(input);
    if (!place) return;
    await addItem({ title: place.name, placeId: place.id, category: place.category });
  }

  async function dropPin(lat: number, lng: number) {
    setDropMode(false);
    setNotice("Looking up that spot…");

    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      const body = await res.json();
      const r = body.result;
      await addNewPlace({
        name: r.name || `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
        address: r.address ?? null,
        city: r.city ?? null,
        country: r.country ?? null,
        countryCode: r.countryCode ?? null,
        category: r.category ?? "other",
      });
    } catch {
      await addNewPlace({
        name: `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
        address: null,
        city: null,
        country: null,
        countryCode: null,
        category: "other",
      });
    } finally {
      setNotice(null);
    }
  }

  /// Setting a stop's emoji.
  ///
  /// When the stop is a real place the emoji belongs to the *place*, so it is
  /// written there and shows everywhere that place appears — the map, your
  /// places list and the been map. Anything the map has never heard of has no
  /// place to write to, so those keep a per-stop emoji of their own.
  async function setStopEmoji(item: ItineraryItemDTO, emoji: string | null) {
    // Picking one is the end of the job, so the picker goes away. It used to
    // stay open over the rest of the stop's fields with the grid still up,
    // which reads as the screen having got stuck rather than as having worked.
    setEmojiFor(null);

    if (!item.placeId || !item.place) {
      await patchItem(item.id, { emoji });
      return;
    }

    setBusy(true);
    setError(null);

    const res = await fetch(`/api/places/${item.placeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not change that emoji");
      return;
    }

    const placeId = item.placeId;
    setItems((prev) =>
      prev.map((i) =>
        i.placeId === placeId && i.place
          ? // Clear any older per-stop override, which would otherwise keep
            // masking the place's emoji.
            { ...i, emoji: null, place: { ...i.place, emoji } }
          : i,
      ),
    );
    setLibrary((prev) => prev.map((p) => (p.id === placeId ? { ...p, emoji } : p)));

    // An override may still be stored server-side from before this change.
    if (item.emoji) await patchItem(item.id, { emoji: null });
  }

  /// Bumped after a new cover lands, so the <img> asks again.
  ///
  /// The URL never changes — it is always /api/trips/:id/cover — so without
  /// this, replacing the photograph leaves the old one on screen until a
  /// reload.
  const [coverSeq, setCoverSeq] = useState(0);

  async function setCover(file: File) {
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/trips/${trip.id}/cover`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not use that photo");
      return;
    }
    setTrip((t) => ({ ...t, coverUrl: `/api/trips/${t.id}/cover` }));
    setCoverSeq((n) => n + 1);
  }

  async function removeCover() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/trips/${trip.id}/cover`, { method: "DELETE" });
    setBusy(false);

    if (!res.ok) {
      setError("Could not remove that photo");
      return;
    }
    setTrip((t) => ({ ...t, coverUrl: null }));
  }

  async function setPublished(next: boolean) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not change who can see this");
      return;
    }
    setTrip(body.trip);
  }

  /// Returns null when it worked, or the reason it did not — the caller names
  /// the file that failed, which it knows and this does not.
  async function uploadDocument(file: File, itemId: string | null): Promise<string | null> {
    try {
      const prepared = await prepareDocumentFile(file);
      const { put } = await import("@vercel/blob/client");

      if (prepared.size === 0) return "That file is empty";
      if (prepared.size > MAX_DOCUMENT_BYTES) return documentTooLargeError();

      const contentType = resolveDocumentType({
        type: prepared.type,
        name: prepared.name || file.name,
      });
      if (!contentType) return DOCUMENT_TYPE_ERROR;

      const tokenRes = await fetch(`/api/trips/${trip.id}/documents/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          contentType,
          size: prepared.size,
          itemId,
        }),
      });
      if (!tokenRes.ok) return await errorFromUploadResponse(tokenRes);

      const granted = (await tokenRes.json()) as {
        token: string;
        pathname: string;
        contentType: string;
      };

      // Straight to Blob, not through this Function. A screenshot that used
      // to die as a dropped connection on the 4.5 MB body limit now lands.
      const blob = await put(granted.pathname, prepared, {
        access: "private",
        token: granted.token,
        contentType: granted.contentType,
      });

      const res = await fetch(`/api/trips/${trip.id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pathname: blob.pathname,
          name: file.name,
          contentType: granted.contentType,
          itemId,
        }),
      });
      if (!res.ok) return await errorFromUploadResponse(res);
      const json = (await res.json()) as { document: TripDocumentDTO };
      setFiles((prev) => [json.document, ...prev]);
      return null;
    } catch (error) {
      if (error instanceof Error) {
        const message = error.message.replace(/^Vercel Blob:\s*/i, "");
        if (/too large|file is too large/i.test(message)) return documentTooLargeError();
        if (/content type|not allowed/i.test(message)) return DOCUMENT_TYPE_ERROR;
        if (/failed to fetch|network|load failed|connection/i.test(message)) {
          return "The connection dropped while sending that file. Try again.";
        }
        if (message && message.length < 180) return message;
      }
      return "Could not upload that";
    }
  }

  async function deleteDocument(id: string) {
    const gone = files.find((f) => f.id === id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!res.ok && gone) {
      setFiles((prev) =>
        [gone, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      setError("Could not remove that file");
    }
  }

  /// Re-reads the itinerary after something outside this component added to
  /// it. A router refresh is no use: the items live in state seeded from
  /// props, so the server can hand down new ones all it likes and the list
  /// will not notice.
  async function reloadItems() {
    try {
      const res = await fetch(`/api/trips/${trip.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: ItineraryItemDTO[] };
      setItems(body.items);
    } catch {
      // The places are saved either way; the worst case is a stale list until
      // the next reload, which is better than an error over a successful add.
    }
  }

  /// Filing a stop under a category, and the place it points at with it.
  ///
  /// A stop that has a place takes its icon from the place, so setting the
  /// category on the stop alone leaves a restaurant showing the aeroplane a
  /// gazetteer guessed. Choosing a category for somewhere with a place means
  /// that place is a restaurant — the same way its emoji already applies
  /// everywhere it appears.
  async function setStopCategory(item: ItineraryItemDTO, category: string) {
    await patchItem(item.id, { category });
    if (!item.placeId || item.place?.category === category) return;

    const res = await fetch(`/api/places/${item.placeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) {
      setError("Could not change that category");
      return;
    }
    const body = (await res.json()) as { place: PlaceDTO };
    // Every stop pointing at this place, and the library behind the map.
    setItems((prev) =>
      prev.map((i) => (i.placeId === body.place.id ? { ...i, place: body.place } : i)),
    );
    setLibrary((prev) => prev.map((p) => (p.id === body.place.id ? body.place : p)));
  }

  function patchItem(
    id: string,
    changes: Partial<ItineraryItemDTO> & { arrivalUserIds?: string[] },
  ) {
    return mutate<{ item: ItineraryItemDTO }>(
      () =>
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }),
      (body) =>
        setItems((prev) => prev.map((i) => (i.id === body.item.id ? body.item : i))),
      "Could not update that stop",
    );
  }

  async function removeItem(id: string) {
    setBusy(true);
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
    else setError("Could not remove that stop");
  }

  /// Reordering is a straight swap of the two neighbours' positions.
  async function move(index: number, direction: -1 | 1) {
    const a = dayItems[index];
    const b = dayItems[index + direction];
    if (!a || !b) return;

    await patchItem(a.id, { position: b.position });
    await patchItem(b.id, { position: a.position });
  }

  /// Moving one stop to a particular place in the day, which is what dragging
  /// does. The arrows swap neighbours; this cannot, because dragging the last
  /// stop to the top is not a swap.
  ///
  /// The day is renumbered from zero afterwards and only the rows whose number
  /// actually changed are saved. Positions arrive as whatever earlier edits
  /// left behind, and reasoning about gaps in them is how off-by-one bugs get
  /// in.
  async function moveTo(from: number, to: number) {
    if (from === to) return;

    const next = [...dayItems];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);

    // Shown before it is saved. Dragging that snaps back for half a second
    // feels broken even when it worked.
    setItems((prev) => {
      const positions = new Map(next.map((item, i) => [item.id, i]));
      return prev.map((item) =>
        positions.has(item.id) ? { ...item, position: positions.get(item.id)! } : item,
      );
    });

    await Promise.all(
      next
        .map((item, i) => (item.position === i ? null : patchItem(item.id, { position: i })))
        .filter(Boolean),
    );
  }

  /// Dragging a stop up or down the day.
  ///
  /// Pointer events rather than the HTML drag-and-drop API, which does not
  /// exist on touch: a phone fires no dragstart at all, so the whole feature
  /// was invisible on the device most likely to be used while actually on the
  /// trip. Pointer events are the same code for a mouse and a finger.
  const draggingFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /// Each row's position on screen, measured when a drag starts, so working out
  /// which row the finger is over is a comparison rather than a hit test on
  /// whatever is under it — the dragged row itself is under it.
  const rowBounds = useRef<{ top: number; bottom: number }[]>([]);
  const listRef = useRef<HTMLOListElement>(null);

  function measureRows() {
    const list = listRef.current;
    if (!list) return;
    rowBounds.current = [...list.querySelectorAll("[data-stop]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
  }

  function rowAt(y: number) {
    const rows = rowBounds.current;
    if (rows.length === 0) return null;
    if (y < rows[0]!.top) return 0;
    if (y > rows[rows.length - 1]!.bottom) return rows.length - 1;
    const hit = rows.findIndex((r) => y >= r.top && y <= r.bottom);
    return hit === -1 ? null : hit;
  }

  const dayDate = dateForDay(trip, activeDay);

  /// Where to ask about, day by day. A trip through three cities is three
  /// questions; one that stays put is still one.
  const segments = useMemo(
    () => (trip.startDate ? weatherSegments(trip.startDate, days, items) : []),
    [trip.startDate, days, items],
  );
  const weather = useTripWeather(segments);
  const todayWeather = dayDate ? weather.get(dayDate.toISOString().slice(0, 10)) : undefined;
  /// Journeys that took off earlier and land today.
  const arrivalsToday = items.filter(
    (i) =>
      i.kind === "travel" &&
      i.endDayOffset > 0 &&
      i.endTime &&
      i.dayIndex + i.endDayOffset === activeDay,
  );
  const toBook = outstanding(items).length;
  /// How many stops each day has, for the dots on the calendar.
  const dayCounts = useMemo(() => {
    const counts = Array.from({ length: days }, () => 0);
    for (const item of items) {
      if (item.dayIndex < counts.length) counts[item.dayIndex] += 1;
    }
    return counts;
  }, [items, days]);
  const toPack = useMemo(() => resources.filter((r) => isPacking(r.kind)), [resources]);
  const toGet = useMemo(() => resources.filter((r) => !isPacking(r.kind)), [resources]);
  /// The count on the tab is both lists: somebody looking at "Before you go"
  /// wants to know whether anything is outstanding, and a sock counts.
  const toSort = resources.filter((r) => !r.ready).length;

  const stopCount = items.filter((i) => i.kind !== "travel").length;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-line bg-surface p-5 lg:h-full lg:w-[460px] lg:border-r lg:border-b-0 xl:w-[580px]">
        {/* The cover: the trip's photograph when it has one, and until then
            its own colour fading into evergreen.
            
            The photograph goes under a scrim rather than behind nothing. The
            title and dates are white and sit on top of it, and a bright sky in
            the wrong corner makes them unreadable. */}
        <div
          className="relative -mx-5 -mt-5 flex min-h-44 flex-col justify-end px-5 pt-14 pb-5 text-[color:var(--paint-card)] lg:mx-0 lg:mt-0 lg:rounded-3xl"
          style={
            trip.coverUrl
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(11,33,28,0.45) 0%, rgba(11,33,28,0.15) 40%, rgba(11,33,28,0.78) 100%), url(${trip.coverUrl}${coverSeq > 0 ? `?v=${coverSeq}` : ""})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  background: `linear-gradient(160deg, ${trip.color} 0%, var(--paint-evergreen-900) 75%)`,
                }
          }
        >
          <Link
            href="/trips"
            className="absolute top-4 left-4 inline-flex items-center gap-1 rounded-full border border-white/20 bg-[rgba(11,33,28,0.34)] px-3 py-1.5 text-xs font-medium"
          >
            ‹ Trips
          </Link>
          {/* Changing the photograph, for anyone who can edit the trip — which
              is who the upload route lets through. On the cover itself rather
              than in a settings panel: it is the thing being changed, and it
              is right there. */}
          {/* The cover's own controls, together in one corner. The bottom of
              this band is the trip's name and dates, and a button down there
              runs into them on a narrow panel. */}
          <div className="absolute top-4 right-4 flex flex-wrap items-center justify-end gap-1.5">
            {trip.coverUrl && (
              <button
                type="button"
                className="rounded-full border border-white/20 bg-[rgba(11,33,28,0.34)] px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                disabled={busy}
                onClick={() => void removeCover()}
              >
                Remove photo
              </button>
            )}

            {/* Changing the photograph, for anyone who can edit the trip —
                which is who the upload route lets through. */}
            <label className="cursor-pointer rounded-full border border-white/20 bg-[rgba(11,33,28,0.34)] px-3 py-1.5 text-xs font-medium hover:bg-[rgba(11,33,28,0.5)]">
              📷 {trip.coverUrl ? "Change" : "Add a photo"}
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = "";
                  if (file) void setCover(file);
                }}
              />
            </label>

            {/* Whether a trip is public should be readable without opening a
                panel — it is the one setting where not knowing is a problem. */}
            {role === "owner" ? (
              <button
                type="button"
                className="rounded-full border border-white/20 bg-[rgba(11,33,28,0.34)] px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                disabled={busy}
                onClick={() => setPublished(trip.publishedAt === null)}
                title={
                  trip.publishedAt
                    ? "On your profile and in your followers' feeds. Click to make private."
                    : "Only you and anyone you've invited. Click to publish."
                }
              >
                {trip.publishedAt ? "🌍 Published" : "🔒 Private"}
              </button>
            ) : (
              <span className="rounded-full border border-white/20 bg-[rgba(11,33,28,0.34)] px-3 py-1.5 text-xs font-medium">
                ✏️ Shared with you
              </span>
            )}
          </div>
          <h1 className="text-3xl leading-tight xl:text-4xl">{trip.title}</h1>
          <p className="mt-1.5 text-sm text-white/80">
            {[
              tripWhere(trip),
              formatRange(trip),
              `${days} ${days === 1 ? "day" : "days"}`,
              stopCount > 0 ? `${stopCount} ${stopCount === 1 ? "stop" : "stops"}` : null,
              // What the plan adds up to so far. Only once something is
              // priced, and deliberately not called a budget: it is the sum
              // of what has been written down, which on a half-planned trip
              // is a floor rather than an estimate.
              anyPriced(items) ? formatMoney(totalOf(items), trip.currency) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <PublishPrompt
          tripId={trip.id}
          trip={trip}
          stops={items.length}
          owned={role === "owner"}
          onPublished={() => setTrip((t) => ({ ...t, publishedAt: new Date().toISOString() }))}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <TripPeople
            tripId={trip.id}
            role={role}
            ownerLabel={ownerLabel}
            ownerImage={ownerImage}
            initialPeople={people}
          />
          {/* Renaming, sharing and deleting stay with the owner; an editor
              gets the itinerary and nothing else. */}
          {role === "owner" && (
            <>
              <TripSettings trip={trip} onUpdated={setTrip} />
              <ShareTrip tripId={trip.id} />
            </>
          )}
        </div>

        {/* Three lists, not three pages: the trip's days, what still has to be
            booked, and what has to be sorted before leaving. The counts are on
            the tabs because an unbooked thing you have forgotten about is the
            only one that costs anything. */}
        <div className="flex flex-wrap gap-1.5">
          {([
            ["days", "Days", 0],
            ["bookings", "Bookings", toBook],
            ["before", "Before you go", toSort],
            ["files", "Files", files.length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={`chip px-3 py-1.5 text-[13px] ${view === id ? "is-solid" : ""}`}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
              {count > 0 && (
                <span className={`tabular-nums ${view === id ? "opacity-70" : "text-muted"}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {view === "days" && (
          <>
        {/* One pill a day, the weekday over the date, so "day 3" never has to
            be converted into which Saturday it is. */}
        <div className="-mx-5 flex shrink-0 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {Array.from({ length: days }, (_, i) => {
            const date = dateForDay(trip, i);
            const on = activeDay === i;
            const has = (dayCounts[i] ?? 0) > 0;
            return (
              <button
                key={i}
                type="button"
                aria-label={date ? `Day ${i + 1}, ${formatDay(date)}` : `Day ${i + 1}`}
                aria-pressed={on}
                onClick={() => setActiveDay(i)}
                className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 leading-none transition-colors ${
                  on
                    ? "border-primary bg-primary text-on-primary"
                    : "border-line bg-surface hover:bg-foreground/5"
                }`}
              >
                <span className={`text-[11px] ${on ? "opacity-80" : "text-muted"}`}>
                  {date ? formatDay(date, { month: undefined, day: undefined }) : "Day"}
                </span>
                <span className="mt-1 text-lg font-semibold tabular-nums">
                  {date ? date.getUTCDate() : i + 1}
                </span>
                <span
                  aria-hidden
                  className={`mt-1 size-1 rounded-full ${
                    has ? (on ? "bg-on-primary" : "bg-accent") : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
          {!trip.endDate && (
            <button
              type="button"
              aria-label="Add a day"
              className="flex w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line text-lg text-muted hover:bg-foreground/5"
              onClick={() => {
                setExtraDays((n) => n + 1);
                setActiveDay(days);
              }}
            >
              ＋
            </button>
          )}
        </div>

        <div>
          <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="display text-xl leading-tight">Day {activeDay + 1}</span>
            <span className="text-sm text-muted">
              {[
                `${dayItems.length} ${dayItems.length === 1 ? "stop" : "stops"}`,
                dayDate ? formatDay(dayDate) : null,
                // Only when somebody has priced something. A day of unpriced
                // stops showing a confident zero is worse than showing
                // nothing.
                anyPriced(dayItems) ? formatMoney(totalOf(dayItems), trip.currency) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {/* Only when there is something real to say. A day beyond the
                forecast, or one the archive has not caught up with, shows
                nothing rather than a number somebody might pack from. */}
            {todayWeather && (
              <span
                className="text-sm text-muted"
                title={`${condition(todayWeather.code).label}${
                  todayWeather.kind === "recorded" ? " — what it did" : ""
                }`}
              >
                {condition(todayWeather.code).icon} {todayWeather.high}°/{todayWeather.low}°
                {todayWeather.rain !== null && todayWeather.rain >= 30
                  ? ` · ${todayWeather.rain}% rain`
                  : ""}
              </span>
            )}
          </h2>

          {/* An overnight flight belongs to the evening it left, but the
              morning it lands is a real part of this day and the one thing on
              it that cannot move. Shown here rather than moved, because the
              journey itself still belongs to the day it started. */}
          {arrivalsToday.map((leg) => {
            const who = whoArrivesLabel(leg.arrivals);
            return (
            <p key={`arrives-${leg.id}`} className="mt-2 text-xs text-accent-text">
              ✈️ Lands {leg.endTime}
              {leg.toPlace ? ` · ${leg.toPlace.name}` : ""}
              {who ? ` — ${who}` : ""}
              <span className="text-muted"> — {leg.title}</span>
            </p>
            );
          })}

          {dayItems.length === 0 && arrivalsToday.length === 0 ? (
            <>
              <p className="mt-3 text-sm text-muted">
                Nothing planned for this day yet.
              </p>
              {/* A gap in a trip is Otto's moment, but which half of him
                  depends on what is around it. With nothing anywhere on the
                  trip he has nothing to read, so he explains instead of
                  offering — and the offer would spend a run to guess. Once
                  there is something to work from, he offers. */}
              {items.length === 0 ? (
                otto && <OttoSays topic="emptyTrip" pose="planning" className="mt-4" />
              ) : (
                <AskOtto tripId={trip.id} dayIndex={activeDay} onApplied={reloadItems} />
              )}
            </>
          ) : (
            <ol ref={listRef} className="mt-3 space-y-2">
              {dayItems.map((item, index) => {
                const meta = categoryOf(item.category);
                const timed = dayItems.some((i) => timingLabel(i));
                const open = selectedId === item.id;
                const leg = item.kind === "travel";
                const arriving = whoArrivesLabel(item.arrivals);
                /// The details are open when somebody opened them, and already
                /// open when this stop uses one of the things inside — a
                /// setting nobody can see is worse than a busy card.
                const showMore =
                  moreFor === item.id ||
                  item.booking !== null ||
                  Boolean(item.bookingRef) ||
                  files.some((f) => f.itemId === item.id);
                return (
                  <li
                    key={item.id}
                    data-stop
                    className={`transition-colors ${
                      leg ? "rounded-2xl bg-background p-2.5" : "card p-3"
                    } ${open ? "ring-2 ring-accent" : ""} ${
                      dragOver === index ? "ring-2 ring-accent/60" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Once anything on the day says when or how long. A
                          stop with neither keeps the column so the cards line
                          up; a day with none gives the room back. */}
                      {timed && (
                        <span className="w-16 shrink-0 text-xs text-muted tabular-nums">
                          {timingLabel(item)?.replace(/^about /, "") ?? ""}
                        </span>
                      )}
                      {/* The number is the handle, and has been since dragging
                          existed — but a numbered badge reads as a label, so
                          people found the arrows inside and never knew. It
                          keeps the job; the grip beside it is what says so. */}
                      <span
                        title="Drag to reorder"
                        aria-label={`Stop ${index + 1}. Drag to reorder.`}
                        className="grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-full text-[11px] font-semibold text-white select-none active:cursor-grabbing"
                        style={{ background: trip.color }}
                        {...dragHandlers(index)}
                      >
                        {index + 1}
                      </span>
                      <span
                        aria-hidden
                        title="Drag to reorder"
                        className="-ml-1.5 shrink-0 cursor-grab touch-none leading-none text-muted/45 select-none hover:text-muted active:cursor-grabbing"
                        {...dragHandlers(index)}
                      >
                        ⠿
                      </span>
                      <button
                        type="button"
                        aria-label={`Change the emoji for ${item.title}`}
                        title="Change emoji"
                        className={`tile shrink-0 transition-shadow ${
                          leg ? "size-8 rounded-full text-sm" : "size-11 text-lg"
                        } ${emojiFor === item.id ? "ring-2 ring-accent" : ""}`}
                        style={{ "--tile-color": leg ? "#5F7C8C" : meta.color } as React.CSSProperties}
                        onClick={() =>
                          setEmojiFor((cur) => (cur === item.id ? null : item.id))
                        }
                      >
                        {stopIconOf(item)}
                      </button>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        aria-expanded={open}
                        onClick={() => setSelectedId(open ? null : item.id)}
                      >
                        <p className={`truncate ${leg ? "text-sm" : "text-[15px] font-semibold"}`}>
                          {leg
                            ? [travelMode(item.mode).label, durationLabel(item)].filter(Boolean).join(" · ")
                            : item.title}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {leg ? (
                            <>
                              {item.title}
                              {item.place && item.toPlace
                                ? ` · ${item.place.name} → ${item.toPlace.name}`
                                : ""}
                              {item.startTime && item.endTime
                                ? ` · ${item.startTime}–${item.endTime}`
                                : ""}
                              {item.endTime && item.endDayOffset > 0
                                ? ` · lands +${item.endDayOffset}`
                                : ""}
                              {arriving ? ` · ${arriving}` : ""}
                            </>
                          ) : (
                            <>
                              {meta.label}
                              {item.place?.city ? ` · ${item.place.city}` : ""}
                            </>
                          )}
                          {/* A train is a booking like any other, so the
                              marker is on both branches. */}
                          {item.booking === BOOKING_NEEDED && " · to book"}
                          {item.booking === BOOKING_BOOKED && " · booked ✓"}
                        </p>
                      </button>
                      {/* A leg keeps its clock times on the row: a flight
                          leaves when it leaves, and that is the fact you scan a
                          day for.

                          A stop's duration used to sit here too, as a dropdown
                          on every row — so a day of eight stops was eight
                          dropdowns, and this one read "about 1½ hours" beside a
                          rail already saying "1½ hours". The rail states it now
                          and setting it moved inside, with the day and the
                          rest. */}

                    </div>

                    {/* Moving, removing and directions, shown for the stop
                        being looked at rather than on every card. */}
                    {open && (
                    <div className="mt-2 flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        className="rounded-full px-2 py-1 text-muted hover:bg-foreground/5 disabled:opacity-30"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move earlier"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="rounded-full px-2 py-1 text-muted hover:bg-foreground/5 disabled:opacity-30"
                        disabled={busy || index === dayItems.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move later"
                      >
                        ▼
                      </button>
                      {/* When it leaves and lands. Out on the row this was a
                          pair of empty pills on every journey nobody had timed
                          yet; in here it is the first thing you reach for after
                          opening one. */}
                      {leg && (
                        <div className="ml-auto flex items-center gap-1">
                          <input
                            type="time"
                            aria-label="Departure time"
                            className="input w-[5.5rem] rounded-full px-2 py-1 text-xs"
                            value={item.startTime ?? ""}
                            onChange={(e) =>
                              patchItem(item.id, { startTime: e.target.value || null })
                            }
                          />
                          <span aria-hidden className="text-xs text-muted">
                            →
                          </span>
                          <input
                            type="time"
                            aria-label="Arrival time"
                            className="input w-[5.5rem] rounded-full px-2 py-1 text-xs"
                            value={item.endTime ?? ""}
                            onChange={(e) =>
                              patchItem(item.id, { endTime: e.target.value || null })
                            }
                          />
                          {/* Only a flight is known by its clock. */}
                          {takesTime(item) && <LegLength item={item} onSave={patchItem} />}
                        </div>
                      )}
                      {!leg && (
                        <select
                          aria-label="How long this takes"
                          className="ml-auto rounded-full border border-line bg-surface px-2 py-1 text-xs"
                          value={durationOf(item) ?? ""}
                          onChange={(e) =>
                            patchItem(item.id, {
                              minutes: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">How long?</option>
                          {DURATIONS.map((m) => (
                            <option key={m} value={m}>
                              {formatDuration(m)}
                            </option>
                          ))}
                        </select>
                      )}
                      <CostField
                        costMinor={item.costMinor}
                        currency={trip.currency}
                        onSave={(costMinor) => patchItem(item.id, { costMinor })}
                      />
                      <select
                        aria-label="Move to day"
                        className="rounded-full border border-line bg-surface px-2 py-1 text-xs"
                        value={item.dayIndex}
                        onChange={(e) =>
                          patchItem(item.id, { dayIndex: Number(e.target.value) })
                        }
                      >
                        {Array.from({ length: days }, (_, i) => (
                          <option key={i} value={i}>
                            Day {i + 1}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rounded-full px-2 py-1 text-muted hover:bg-foreground/5"
                        disabled={busy}
                        onClick={() => removeItem(item.id)}
                      >
                        Remove
                      </button>
                      {item.place && (
                        <a
                          href={directionsUrl({
                            lat: item.place.lat,
                            lng: item.place.lng,
                            name: item.place.name,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Directions to ${item.place.name}`}
                          title={`Directions to ${item.place.name}`}
                          className="rounded-full px-2 py-1 hover:bg-foreground/5"
                        >
                          <DirectionsIcon />
                        </a>
                      )}
                    </div>
                    )}

                    {emojiFor === item.id && (
                      <div className="mt-2 border-t border-line pt-2">
                        <EmojiField
                          emoji={item.place ? item.place.emoji : item.emoji}
                          category={item.category}
                          fallback={categoryOf(item.category).icon}
                          onChange={(emoji) => setStopEmoji(item, emoji)}
                        />
                        <p className="mt-1.5 text-xs text-muted">
                          {item.place ? (
                            <>
                              Applies to{" "}
                              <span className="font-medium">{item.place.name}</span>{" "}
                              everywhere — the map, your places and your been map.
                            </>
                          ) : (
                            "Applies to this entry. It isn't a place on the map, so it has nowhere else to show."
                          )}
                        </p>
                      </div>
                    )}

                    {selectedId === item.id && (
                      <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                        <input
                          // Uncontrolled and saved on blur, like the notes below:
                          // no request per keystroke, and `key` resets it when a
                          // different stop is selected.
                          key={`name-${item.id}`}
                          className="input text-sm"
                          aria-label="Name of this stop"
                          defaultValue={item.title}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next && next !== item.title) patchItem(item.id, { title: next });
                            else e.target.value = item.title;
                          }}
                        />

                        {/* What you wrote about the place itself, on your own
                            map. Two different notes have always existed — one
                            about the place, which follows it onto every trip it
                            is ever on, and one about this stop on this day —
                            and only the second was ever shown here, so a note
                            written on the map looked lost the moment the place
                            went on a trip.

                            Shown rather than edited: two note fields side by
                            side with no way to tell which one you are changing
                            is worse than one and a reminder. */}
                        {item.place?.notes && (
                          <div className="rounded-xl border border-line bg-surface p-2.5">
                            <p className="text-xs text-muted">
                              Your note on {item.place.name}
                            </p>
                            <p className="mt-1 text-xs whitespace-pre-line">{item.place.notes}</p>
                            <p className="mt-1.5 text-[11px] text-muted">
                              On the place, so it shows on every trip it is on.
                            </p>
                          </div>
                        )}

                        <textarea
                          // Uncontrolled and saved on blur: no keystroke-by-keystroke
                          // requests, and `key` resets it when the stop changes.
                          key={item.id}
                          aria-label="Notes for this stop"
                          className="input min-h-14 resize-y text-xs"
                          placeholder={
                            item.place?.notes
                              ? "Notes for this stop — booking reference, what to order…"
                              : "Notes — booking reference, what to order…"
                          }
                          defaultValue={item.notes ?? ""}
                          onBlur={(e) => {
                            const next = e.target.value.trim() || null;
                            if (next !== item.notes) patchItem(item.id, { notes: next });
                          }}
                        />
                        {leg && (
                          <WhoArrives
                            people={party}
                            selectedIds={(item.arrivals ?? []).map((p) => p.userId)}
                            onChange={(ids) => patchItem(item.id, { arrivalUserIds: ids })}
                          />
                        )}
                        {/* The category, the files and whether it needs
                            booking. All three matter and none is asked on most
                            stops — a place brings its own category, and the
                            great majority of stops are not bookings — so they
                            sit behind a line rather than in front of the notes,
                            which is the thing people actually come here to
                            write.

                            Open already when this stop uses one of them: a
                            setting nobody can see is worse than a busy card. */}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-xs text-muted hover:bg-foreground/5"
                          aria-expanded={showMore}
                          onClick={() => setMoreFor(showMore ? null : item.id)}
                        >
                          <span className="flex-1 text-left">More details</span>
                          <span aria-hidden>{showMore ? "⌃" : "⌄"}</span>
                        </button>

                        {showMore && (
                          <>
                        <select
                          aria-label="Category for this stop"
                          className="input text-xs"
                          value={item.category}
                          onChange={(e) => void setStopCategory(item, e.target.value)}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.icon} {c.label}
                            </option>
                          ))}
                        </select>

                        {/* The confirmation, on the thing it confirms. The
                            Files tab still shows it — this is the same list,
                            read from the day it belongs to. */}
                        <TripFiles
                          files={files}
                          itemId={item.id}
                          onUpload={uploadDocument}
                          onRemove={deleteDocument}
                          busy={busy}
                        />

                        {/* The tick that puts this on the bookings tab, and the
                            one that takes it off again. Nothing is a booking
                            until somebody says so, so the default is neither
                            state and most stops never grow this at all. */}
                        <div className="flex flex-wrap items-center gap-3 pt-0.5">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              className="size-3.5"
                              checked={item.booking !== null}
                              onChange={() =>
                                patchItem(item.id, {
                                  booking: item.booking === null ? BOOKING_NEEDED : null,
                                  bookingRef: item.booking === null ? item.bookingRef : null,
                                })
                              }
                            />
                            Needs booking
                          </label>
                          {item.booking !== null && (
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                className="size-3.5"
                                checked={item.booking === BOOKING_BOOKED}
                                onChange={() =>
                                  patchItem(item.id, { booking: nextState(item.booking) })
                                }
                              />
                              Booked
                            </label>
                          )}
                        </div>

                        {item.booking === BOOKING_NEEDED && (
                          <label className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            Book by
                            <input
                              type="date"
                              className="input w-40 px-1.5 py-1 text-xs"
                              value={item.bookBy ? item.bookBy.slice(0, 10) : ""}
                              onChange={(e) =>
                                patchItem(item.id, { bookBy: e.target.value || null })
                              }
                            />
                            {item.bookBy && (
                              <span
                                className={
                                  urgencyOf(item.bookBy) === "overdue"
                                    ? "text-red-600"
                                    : urgencyOf(item.bookBy) === "soon"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted"
                                }
                              >
                                {deadlineLabel(item.bookBy)}
                              </span>
                            )}
                          </label>
                        )}

                        {item.booking === BOOKING_BOOKED && (
                          <input
                            key={`stopref-${item.id}`}
                            className="input text-xs"
                            aria-label="Confirmation number"
                            placeholder="Confirmation number, reference…"
                            defaultValue={item.bookingRef ?? ""}
                            onBlur={(e) => {
                              const next = e.target.value.trim() || null;
                              if (next !== item.bookingRef) patchItem(item.id, { bookingRef: next });
                            }}
                          />
                        )}
                          </>
                        )}

                        {item.kind === "travel" && item.place && item.toPlace && (
                          <a
                            href={directionsUrl(
                              { lat: item.toPlace.lat, lng: item.toPlace.lng, name: item.toPlace.name },
                              { lat: item.place.lat, lng: item.place.lng, name: item.place.name },
                              travelMode(item.mode).dirflg,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent-text hover:underline"
                          >
                            {travelMode(item.mode).label} times: {item.place.name} →{" "}
                            {item.toPlace.name} →
                          </a>
                        )}

                        {item.kind !== "travel" && item.place && (
                          <div className="flex flex-wrap items-center gap-3">
                            <Link
                              href={`/?place=${item.place.id}`}
                              className="text-xs text-accent-text hover:underline"
                            >
                              Open on the map →
                            </Link>
                            <a
                              href={directionsUrl({
                                lat: item.place.lat,
                                lng: item.place.lng,
                                name: item.place.name,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
                            >
                              <DirectionsIcon />
                              Directions
                            </a>
                            {/* Routing from the stop before it is the question you
                                actually have while standing at one. */}
                            {(() => {
                              const previous = dayItems[index - 1]?.place;
                              if (!previous) return null;
                              return (
                                <a
                                  href={directionsUrl(
                                    { lat: item.place!.lat, lng: item.place!.lng, name: item.place!.name },
                                    { lat: previous.lat, lng: previous.lng, name: previous.name },
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-accent-text hover:underline"
                                >
                                  From {previous.name} →
                                </a>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {/* Here rather than on the importer. Somebody planning a trip is
            already looking at it and already on a day; sending them to a page
            headed "a trip you've taken" to pick both back out of dropdowns was
            the wrong shape twice over. */}
        <AddFromLink
          trip={trip}
          days={days}
          activeDay={activeDay}
          region={searchRegion}
          onAdded={reloadItems}
        />

        <AddTravel
          places={library}
          party={party}
          onAdd={addItem}
          region={searchRegion}
          onSaveNew={async (r) => {
            const place = await savePlace({
              name: r.name,
              lat: r.lat,
              lng: r.lng,
              address: r.address,
              city: r.city,
              country: r.country,
              countryCode: r.countryCode,
              category: r.category,
            });
            return place?.id ?? null;
          }}
          busy={busy}
        />

        <AddStop
          destination={searchRegion}
          search={{
            query,
            setQuery,
            shownResults,
            around,
            setAround,
            elsewhere,
            showElsewhere,
            setShowElsewhere,
          }}
          places={library}
          usedPlaceIds={new Set(items.map((i) => i.placeId).filter(Boolean) as string[])}
          onAdd={addItem}
          onAddNew={addNewPlace}
          dropMode={dropMode}
          onToggleDrop={() => setDropMode((v) => !v)}
          notice={notice}
          busy={busy}
        />
          </>
        )}

        {view === "bookings" && (
          <TripBookings
            trip={trip}
            items={items}
            onToggle={(item) =>
              patchItem(item.id, { booking: nextState(item.booking) })
            }
            onRef={(item, ref) => patchItem(item.id, { bookingRef: ref })}
            onOpen={(item) => {
              // Straight to the stop on its own day, because the next question
              // after "have I booked this" is usually "what time was it again".
              setActiveDay(item.dayIndex);
              setSelectedId(item.id);
              setView("days");
            }}
          />
        )}

        {view === "before" && (
          <div className="space-y-6">
            <TripWants
              tripId={trip.id}
              initial={wants}
              me={me}
              isOwner={role === "owner"}
            />
            <TripResources tripId={trip.id} initial={toGet} canEdit />
            <TripPacking tripId={trip.id} initial={toPack} canEdit otto={otto} />
          </div>
        )}

        {view === "files" && (
          <TripFiles
            files={files}
            onUpload={uploadDocument}
            onRemove={deleteDocument}
            labelFor={(id) => items.find((i) => i.id === id)?.title ?? null}
            busy={busy}
          />
        )}
      </aside>

      {/* A real height rather than a minimum: the map fills its box with a
          percentage height, which needs something definite to resolve against.
          See the same note in SharedTrip. */}
      <div className="relative h-[55vh] lg:h-auto lg:min-h-0 lg:flex-1">
        <MapCanvas
          pins={pins}
          route={route}
          legs={legs}
          routeColor={trip.color}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMapClick={dropMode ? dropPin : undefined}
          onPlaceSelect={setTapped}
          fitToken={`trip-${trip.id}-${wholeTrip ? "all" : activeDay}-${foundToken}`}
        />

        <div className="pointer-events-none absolute top-4 left-4 flex flex-wrap items-center gap-2">
          <span className="glass rounded-full px-3.5 py-2 text-sm font-medium">
            Day {activeDay + 1}
            {dayDate ? <span className="text-muted"> · {formatDay(dayDate, { weekday: undefined })}</span> : null}
          </span>
          <div className="glass pointer-events-auto flex rounded-full p-1 text-xs font-medium" role="group" aria-label="What the map shows">
            {([["day", "This day"], ["all", "Whole trip"]] as const).map(([id, label]) => {
              const on = wholeTrip === (id === "all");
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 ${on ? "bg-primary text-on-primary" : "text-muted hover:text-foreground"}`}
                  onClick={() => setWholeTrip(id === "all")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {tapped && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="card flex max-w-sm items-center gap-3 p-3 shadow-card">
              <span aria-hidden className="text-lg">
                {categoryOf(tapped.category).icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{tapped.name}</p>
                <p className="text-xs text-muted">
                  Add to day {activeDay + 1}?
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary shrink-0 text-xs"
                disabled={busy}
                onClick={async () => {
                  const place = tapped;
                  setTapped(null);
                  // With where it is, so it counts towards the city and country
                  // totals like anything else saved.
                  await addNewPlace(await enrichSelectedPlace(place));
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="shrink-0 text-xs text-muted hover:underline"
                onClick={() => setTapped(null)}
              >
                No
              </button>
            </div>
          </div>
        )}
        {dropMode && (
          <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
            <p className="glass rounded-full px-4 py-2 text-sm">
              Click the map to add a stop to day {activeDay + 1}
            </p>
          </div>
        )}
        {pins.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
            <p className="glass rounded-full px-4 py-2 text-sm">
              Add saved places to this trip to see them on the map
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/// Adding a journey between two places you have already saved. Getting from
/// city to city is most of an international trip, and it is a leg rather than
/// a stop: two ends, a departure and an arrival.
function AddTravel({
  places,
  party,
  onAdd,
  onSaveNew,
  region,
  busy,
}: {
  places: PlaceDTO[];
  /// Who can be tagged as arriving. Empty or a single person hides the picker.
  party: PartyPerson[];
  /// Saves a place found by searching and hands back its id, so a journey can
  /// start or end somewhere that was never in the library.
  onSaveNew: (result: SearchResult) => Promise<string | null>;
  region?: string[] | string | null;
  onAdd: (payload: {
    title: string;
    placeId?: string | null;
    category?: string;
    kind?: "stop" | "travel";
    toPlaceId?: string | null;
    mode?: string;
    startTime?: string | null;
    endTime?: string | null;
    minutes?: number | null;
    endDayOffset?: number;
    arrivalUserIds?: string[];
  }) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string>("train");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [departs, setDeparts] = useState("");
  const [arrives, setArrives] = useState("");
  /// Kept as typed; what it was understood as is shown under the field.
  const [length, setLength] = useState("");
  /// Days later it lands. Offered as a tick rather than a number because the
  /// only case anybody meets is the overnight one.
  const [nextDay, setNextDay] = useState(false);
  const [arrivalUserIds, setArrivalUserIds] = useState<string[]>([]);

  const from = places.find((p) => p.id === fromId);
  const to = places.find((p) => p.id === toId);

  if (!open) {
    return (
      <button
        type="button"
        className="self-start text-xs text-muted hover:underline"
        onClick={() => setOpen(true)}
      >
        + Add a train, flight or ferry
      </button>
    );
  }

  return (
    <div className="card space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Getting somewhere</h2>
          <p className="mt-0.5 text-xs text-muted">
            A journey between two places you&apos;ve saved. Both ends show on the
            map, joined by a line.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-md px-2 py-1 text-muted hover:bg-foreground/5"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TRAVEL_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip ${mode === m.id ? "is-on" : ""}`}
            onClick={() => setMode(m.id)}
          >
            <span aria-hidden>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <PlaceChooser
          label="From"
          places={places}
          value={fromId}
          onPick={setFromId}
          onSaveNew={onSaveNew}
          region={region}
        />
        <PlaceChooser
          label="To"
          places={places}
          value={toId}
          onPick={setToId}
          onSaveNew={onSaveNew}
          region={region}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Departs
          <input
            type="time"
            className="input mt-1"
            value={departs}
            onChange={(e) => setDeparts(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          Arrives
          <input
            type="time"
            className="input mt-1"
            value={arrives}
            onChange={(e) => setArrives(e.target.value)}
          />
        </label>
      </div>

      {/* A train is known as "about two hours" long before anybody knows which
          train. A flight is the exception: its clock times are the fact. */}
      {mode !== "plane" && (
        <label className="text-xs text-muted">
          How long?
          <input
            className="input mt-1"
            placeholder="2h 15m"
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
          <span
            className={`mt-1 block text-xs ${
              length.trim() && !parseDuration(length) ? "text-amber-600 dark:text-amber-400" : "text-muted"
            }`}
          >
            {length.trim() === ""
              ? "However you'd say it — 2h, 90 min, 1:45."
              : parseDuration(length)
                ? `Understood as ${formatDuration(parseDuration(length))}.`
                : "Not understood — try 2h, 90 min or 1:45."}
          </span>
        </label>
      )}

      {/* Only once there is an arrival to qualify, and suggested when the
          clock appears to run backwards — which is exactly what an overnight
          flight east looks like. */}
      {arrives && (
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="size-3.5"
            checked={nextDay}
            onChange={() => setNextDay((on) => !on)}
          />
          Lands the next day
          {departs && arrives <= departs && !nextDay && (
            <span className="text-amber-600 dark:text-amber-400">
              — arrival is before departure, so probably yes
            </span>
          )}
        </label>
      )}

      <WhoArrives
        people={party}
        selectedIds={arrivalUserIds}
        onChange={setArrivalUserIds}
        disabled={busy}
      />

      {places.length < 2 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          You need two saved places to travel between. Add them above first.
        </p>
      )}

      {fromId && fromId === toId && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          That journey starts and ends in the same place.
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !from || !to || fromId === toId}
        onClick={async () => {
          const ok = await onAdd({
            kind: "travel",
            mode,
            title: `${travelMode(mode).label} to ${to!.name}`,
            placeId: fromId,
            toPlaceId: toId,
            category: "transport",
            startTime: departs || null,
            endTime: arrives || null,
            minutes: mode === "plane" ? null : parseDuration(length),
            endDayOffset: nextDay ? 1 : 0,
            arrivalUserIds,
          });
          if (ok) {
            setOpen(false);
            setFromId("");
            setToId("");
            setDeparts("");
            setArrives("");
            setLength("");
            setNextDay(false);
            setArrivalUserIds([]);
          }
        }}
      >
        {busy ? "Adding…" : "Add this journey"}
      </button>
    </div>
  );
}

/// How long a journey takes, on a leg already in the plan.
///
/// Open text rather than a menu: the list of durations was drawn for stops,
/// and a journey runs from a ten-minute walk to a fourteen-hour drive. What
/// was typed stays as typed and is committed when the field is left, so the
/// itinerary is not saved on every keystroke.
function LegLength({
  item,
  onSave,
}: {
  item: { id: string; minutes: number | null };
  onSave: (id: string, patch: { minutes: number | null }) => void;
}) {
  const [text, setText] = useState(
    item.minutes ? (formatDuration(item.minutes)?.replace(/^about /, "") ?? "") : "",
  );
  const parsed = parseDuration(text);
  const wrong = text.trim().length > 0 && parsed === null;

  return (
    <input
      aria-label="How long this journey takes"
      className={`input w-24 rounded-full px-2 py-1 text-xs ${
        wrong ? "text-amber-600 dark:text-amber-400" : ""
      }`}
      placeholder="2h 15m"
      title={wrong ? "Not understood — try 2h, 90 min or 1:45." : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (wrong) return;
        if (parsed !== item.minutes) onSave(item.id, { minutes: parsed });
      }}
    />
  );
}

/// The add-a-stop control: pick one of your saved places, or type anything
/// that isn't a place ("Train to Porto") as a plain entry.
function AddStop({
  destination,
  places,
  usedPlaceIds,
  onAdd,
  onAddNew,
  dropMode,
  onToggleDrop,
  notice,
  busy,
  search,
}: {
  places: PlaceDTO[];
  usedPlaceIds: Set<string>;
  onAdd: (payload: { title: string; placeId?: string | null; category?: string }) => Promise<boolean>;
  onAddNew: (input: {
    name: string;
    lat: number;
    lng: number;
    address: string | null;
    city: string | null;
    country: string | null;
    countryCode: string | null;
    category: string;
  }) => Promise<void>;
  dropMode: boolean;
  onToggleDrop: () => void;
  notice: string | null;
  busy: boolean;
  /// Where the trip is. Searching "Time Out Market" from inside a trip to
  /// Lisbon should not begin with the one in New York.
  destination: string[] | string | null;
  /// The search itself, owned by the planner so its map can pin what this
  /// finds. Four results called Dubai are four identical rows until something
  /// says which is which.
  search: {
    query: string;
    setQuery: (q: string) => void;
    shownResults: SearchResult[];
    around: SearchResult[] | null;
    setAround: (r: SearchResult[] | null) => void;
    elsewhere: SearchResult[];
    showElsewhere: boolean;
    setShowElsewhere: (v: boolean | ((current: boolean) => boolean)) => void;
  };
}) {
  const {
    query,
    setQuery,
    shownResults,
    around,
    setAround,
    elsewhere,
    showElsewhere,
    setShowElsewhere,
  } = search;
  const { categories, categoryOf, placeIconOf } = useCategories();
  const [category, setCategory] = useState("other");
  const trimmed = query.trim();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function findMe() {
    setLocating(true);
    setLocationError(null);

    const position = await currentPosition();
    if (!position.ok) {
      setLocating(false);
      setLocationError(HERE_MESSAGES[position.error]);
      return;
    }

    try {
      const found = await nearbyPlaces(position.lat, position.lng);
      setAround(found);
      if (found.length === 0) {
        setLocationError("Nothing named around here — try dropping a pin instead.");
      }
    } catch {
      setLocationError("Couldn't look up what's around you.");
    } finally {
      setLocating(false);
    }
  }

  const shown = shownResults;

  const whereItGoes = useMemo(() => destinationWords(destination), [destination]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const unused = places.filter((p) => !usedPlaceIds.has(p.id));

    // Somebody typing has said what they want, and it is not this component's
    // business to decide that a trip to Portugal cannot include a flight home
    // from Amsterdam.
    if (q.length > 0) {
      return unused
        .filter((p) =>
          [p.name, p.city, p.country].filter(Boolean).some((f) => f!.toLowerCase().includes(q)),
        )
        .slice(0, 6);
    }

    /// Idle, this is a list of suggestions, and the first six places somebody
    /// saved in alphabetical order are not suggestions — on a trip to Porto it
    /// offered a shop in Tokyo, a walk in Japan and Amsterdam. Narrowed to
    /// where the trip actually goes, it is either useful or empty, and empty
    /// says something true.
    if (whereItGoes.length === 0) return unused.slice(0, 6);

    return unused.filter((p) => goesTo(p, whereItGoes)).slice(0, 6);
  }, [places, usedPlaceIds, query, whereItGoes]);

  /// Whether the narrowing is what emptied the list, as opposed to having no
  /// saved places at all.
  const noneHere =
    query.trim().length === 0 &&
    whereItGoes.length > 0 &&
    matches.length === 0 &&
    places.some((p) => !usedPlaceIds.has(p.id));

  return (
    <div className="border-t border-line pt-4">
      <h2 className="mb-2 text-sm font-semibold">Add a stop</h2>

      <input
        className="input"
        placeholder="Search your places or anywhere in the world…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`chip ${dropMode ? "is-on" : ""}`}
          onClick={onToggleDrop}
        >
          📌 {dropMode ? "Click the map…" : "Drop a pin"}
        </button>

        <button
          type="button"
          className="chip"
          disabled={locating}
          onClick={() => void findMe()}
        >
          📍 {locating ? "Finding you…" : "I'm here now"}
        </button>

        {notice && <span className="text-xs text-muted">{notice}</span>}
      </div>

      {locationError && <p className="mt-1.5 text-xs text-muted">{locationError}</p>}

      {around && around.length > 0 && (
        <>
          <div className="mt-3 mb-1 flex items-center gap-2">
            <p className="text-xs tracking-wide text-muted uppercase">Around you</p>
            <button
              type="button"
              className="text-xs text-muted hover:underline"
              onClick={() => setAround(null)}
            >
              clear
            </button>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {around.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-foreground/5"
                  onClick={async () => {
                    await onAddNew({
                      name: r.name,
                      lat: r.lat,
                      lng: r.lng,
                      address: r.address,
                      city: r.city,
                      country: r.country,
                      countryCode: r.countryCode,
                      category: r.category,
                    });
                    setAround(null);
                  }}
                >
                  {/* The number on the pin out on the map. Four results all
                      called Dubai are four identical lines; this is what says
                      which line is which. */}
                  <span
                    aria-hidden
                    className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: PAINT.sun }}
                  >
                    {i + 1}
                  </span>
                  <PlaceThumb
                    icon={unfiled(r.category, categories).icon}
                    color={unfiled(r.category, categories).color}
                    size={36}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {r.address ?? r.city ?? ""}
                    </span>
                  </span>
                  <span className="text-xs text-accent-text">Add</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {noneHere && (
        <p className="mt-2 text-xs text-muted">
          None of your saved places are where this trip goes — search above for
          somewhere new.
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {matches.map((place) => {
            const meta = categoryOf(place.category);
            return (
              <li key={place.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-foreground/5"
                  onClick={async () => {
                    const ok = await onAdd({
                      title: place.name,
                      placeId: place.id,
                      category: place.category,
                    });
                    if (ok) setQuery("");
                  }}
                >
                  <PlaceThumb
                    photoUrl={place.photoUrl}
                    icon={placeIconOf(place)}
                    color={meta.color}
                    size={36}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{place.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {[place.city, place.country].filter(Boolean).join(", ") || meta.label}
                    </span>
                  </span>
                  <span className="text-xs text-accent-text">Add</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {trimmed.length >= 3 && shown.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs tracking-wide text-muted uppercase">
            {destination && elsewhere.length < shown.length && !showElsewhere
              ? `In ${destination}`
              : "Somewhere new"}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {shown.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left hover:bg-foreground/5"
                  onClick={async () => {
                    await onAddNew({
                      name: r.name,
                      lat: r.lat,
                      lng: r.lng,
                      address: r.address,
                      city: r.city,
                      country: r.country,
                      countryCode: r.countryCode,
                      category: r.category,
                    });
                    setQuery("");
                  }}
                >
                  {/* The number on the pin out on the map. Four results all
                      called Dubai are four identical lines; this is what says
                      which line is which. */}
                  <span
                    aria-hidden
                    className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: PAINT.sun }}
                  >
                    {i + 1}
                  </span>
                  <PlaceThumb
                    icon={unfiled(r.category, categories).icon}
                    color={unfiled(r.category, categories).color}
                    size={36}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.name}</span>
                    <span className="block truncate text-xs text-muted">{r.context}</span>
                  </span>
                  <span className="text-xs text-accent-text">Save &amp; add</span>
                </button>
              </li>
            ))}
          </ul>

          {destination && elsewhere.length > 0 && (
            <button
              type="button"
              className="mt-1.5 text-xs text-muted hover:underline"
              onClick={() => setShowElsewhere((v) => !v)}
            >
              {showElsewhere
                ? `Just the ones in ${destination}`
                : `${elsewhere.length} more elsewhere in the world`}
            </button>
          )}
        </>
      )}

      {query.trim().length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            aria-label="Category for the new entry"
            className="input w-32 shrink-0"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              const ok = await onAdd({ title: query.trim(), category, placeId: null });
              if (ok) setQuery("");
            }}
          >
            Add “{query.trim()}”
          </button>
        </div>
      )}

      {places.length === 0 && (
        <p className="mt-2 text-xs text-muted">
          You have no saved places yet —{" "}
          <Link href="/" className="text-accent-text underline">
            find some on the map
          </Link>
          .
        </p>
      )}
    </div>
  );
}
