import { useCallback, useEffect, useMemo, useState } from "react";
import { timingLabel } from "@/lib/duration";
import { tripRegion } from "@/lib/place-groups";
import { useCategories } from "@/lib/categories";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  PanResponder,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import TripEditor from "@/components/TripEditor";
import ItemEditor, { type ItemDraft } from "@/components/ItemEditor";
import TripCover from "@/components/TripCover";
import TripDays from "@/components/TripDays";
import { dayCount } from "@/lib/trip-days";
import PlaceThumb from "@/components/PlaceThumb";
import OfflineNote from "@/components/OfflineNote";
import OttoSays from "@/components/OttoSays";
import AskOtto from "@/components/AskOtto";
import PublishPrompt from "@/components/PublishPrompt";
import Column from "@/components/Column";
import { WIDE } from "@/lib/wide";
import { type } from "@/lib/type";
import TripMap, { openDirections } from "@/components/TripMap";
import { travelMode } from "@/lib/taxonomy";
import { whoArrivesLabel } from "@/lib/travel-arrivals";
import { isPacking } from "@/lib/resources";
import { useAuth } from "@/lib/auth";
import { dayLabel } from "@/lib/dates";
import { tripRegions } from "@/lib/trip-where";
import { useTripWeather } from "@/lib/use-trip-weather";
import { condition, weatherSegments } from "@/lib/weather";
import {
  API_URL,
  api,
  type ItineraryItem,
  type Place,
  type Trip,
  type TripResource,
  type TripDocument,
} from "@/lib/api";
import TripBookings from "@/components/TripBookings";
import TripResources from "@/components/TripResources";
import TripPacking from "@/components/TripPacking";
import TripFiles from "@/components/TripFiles";
import AddFromLink from "@/components/AddFromLink";
import { BOOKING_BOOKED, BOOKING_NEEDED, outstanding } from "@/lib/bookings";
import { syncPackingReminder, syncReminders } from "@/lib/reminders";
import { useApi } from "@/lib/use-api";
import { usePalette } from "@/lib/use-palette";

type TripResponse = {
  trip: Trip;
  role: string;
  items: ItineraryItem[];
  resources: TripResource[];
  documents: TripDocument[];
};


/// Each row's measured height, per day, so a distance dragged becomes a number
/// of rows. Rows differ — a long title wraps — so the row being dragged
/// supplies the unit.
///
/// Kept outside the component and reached through functions: the gesture
/// callbacks are built during render, and neither a React ref read nor a
/// direct mutation is allowed from there.
const rowHeights: Record<number, number[]> = {};

function recordRowHeight(day: number, index: number, height: number) {
  (rowHeights[day] ??= [])[index] = height;
}

/// How many rows a drag of `dy` covers, from the height of the row being
/// dragged. Falls back to a typical row when nothing has been measured yet.
function rowsMoved(day: number, index: number, dy: number) {
  const unit = rowHeights[day]?.[index] || 64;
  return Math.round(dy / unit);
}

/// Where each day's section sits down the page, and how tall it is. Needed to
/// answer the only question a cross-day drag asks: which day is under the
/// finger now.
const dayBounds: Record<number, { y: number; height: number }> = {};

function recordDayBounds(day: number, y: number, height: number) {
  dayBounds[day] = { y, height };
}

/// Where a row sits within its own day, so a drag can be turned into a
/// position on the page rather than only a distance.
const rowOffsets: Record<number, number[]> = {};

function recordRowOffset(day: number, index: number, y: number) {
  (rowOffsets[day] ??= [])[index] = y;
}

/// Which day the finger is over, or null when it is over none — past the last
/// day, or over a gap nothing has measured yet.
function dayUnder(pageY: number): number | null {
  for (const [day, bounds] of Object.entries(dayBounds)) {
    if (pageY >= bounds.y && pageY < bounds.y + bounds.height) return Number(day);
  }
  return null;
}

/// "Fushimi to Gion" — where a day starts and where it ends, when those are
/// different places. Cities, because that is the coarsest thing a stop
/// reliably knows; a day spent entirely in one of them says nothing here.
function dayJourney(stops: { place?: { city?: string | null } | null }[]): string | null {
  const cities = stops.map((s) => s.place?.city?.trim()).filter(Boolean) as string[];
  const from = cities[0];
  const to = cities[cities.length - 1];
  if (!from || !to || from === to) return null;
  return `${from} to ${to}`;
}

export default function TripScreen() {
  const { stopIconOf, categoryOf } = useCategories();
  const { id, shareUrl } = useLocalSearchParams<{ id: string; shareUrl?: string }>();
  const { data, error, loading, reload, offlineAt } = useApi<TripResponse>(`/api/trips/${id}`);
  const { data: placeData } = useApi<{ places: Place[] }>("/api/places");
  const palette = usePalette();

  const router = useRouter();
  const { user } = useAuth();
  const [settings, setSettings] = useState(false);
  const [item, setItem] = useState<ItemDraft | null>(null);
  /// Which day the map is showing. Null is the whole trip, which is the right
  /// opening view — the shape of the thing before its parts.
  const [mapDay, setMapDay] = useState<number | null>(null);
  /// Which of the trip's three lists is showing: the trip as it will happen,
  /// and the two ways it has to be prepared for.
  const [view, setView] = useState<"days" | "bookings" | "before" | "files">("days");
  /// Which day the link importer is adding to, or null when it is closed.
  ///
  /// A link shared in from TikTok opens it straight away: the person has
  /// already said which trip, and the day is the one thing the share sheet
  /// could not ask.
  const [linkDay, setLinkDay] = useState<number | null>(shareUrl ? 0 : null);

  const days = useMemo(
    () => (data ? dayCount(data.trip, data.items) : 0),
    [data],
  );
  const toBook = outstanding(data?.items ?? []).length;

  /// Keep the phone's reminders matching what the trip says.
  ///
  /// Done on every read of the trip rather than when a deadline is set: a
  /// booking ticked off on the website, or by whoever you are travelling with,
  /// has to stop reminding you too — and the only moment this screen reliably
  /// learns about that is when it reads the trip.
  const reminderKey = (data?.items ?? [])
    .map((i) => `${i.id}:${i.booking ?? ""}:${i.bookBy ?? ""}`)
    .join("|");

  /// What is still not in the bag, and when the trip leaves — the whole of
  /// what the packing reminder is made of.
  const unpacked = (data?.resources ?? []).filter(
    (r) => isPacking(r.kind) && !r.ready,
  ).length;
  const packingKey = `${data?.trip.startDate ?? ""}:${unpacked}`;

  useEffect(() => {
    if (!data) return;
    void syncReminders(
      data.items
        .filter((i) => i.booking === BOOKING_NEEDED && i.bookBy)
        .map((i) => ({
          id: i.id,
          title: i.title,
          bookBy: i.bookBy!,
          tripTitle: data.trip.title,
        })),
      data.items.map((i) => i.id),
    );
    // Keyed on what the reminders are made of, so a re-render that changes
    // nothing does not reschedule the lot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderKey]);

  useEffect(() => {
    if (!data) return;
    void syncPackingReminder(
      { id: data.trip.id, title: data.trip.title, startDate: data.trip.startDate },
      unpacked,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packingKey]);

  /// Where to ask about, day by day. A trip through three cities is three
  /// questions; one that stays put is still one.
  const segments = useMemo(
    () =>
      data?.trip.startDate
        ? weatherSegments(data.trip.startDate, days, data.items)
        : [],
    [data, days],
  );
  const weather = useTripWeather(segments);
  /// Stops per day, for the dots on the calendar.
  const dayCounts = useMemo(() => {
    const counts = Array.from({ length: days }, () => 0);
    for (const item of data?.items ?? []) {
      if (item.dayIndex < counts.length) counts[item.dayIndex] += 1;
    }
    return counts;
  }, [data, days]);
  const toSort = (data?.resources ?? []).filter((r) => !r.ready).length;

  /// A share link is a secret URL: anyone holding it reads the itinerary
  /// without an account, which is the point. The endpoint returns a path
  /// rather than a URL — it has no opinion about which host serves it — so the
  /// address is assembled here.
  const share = useCallback(async () => {
    try {
      const { share: link } = await api<{ share: { path: string } }>(
        `/api/trips/${id}/share`,
        { method: "POST" },
      );
      await Share.share({ message: `${API_URL}${link.path}` });
    } catch (e) {
      Alert.alert("Could not make a link", e instanceof Error ? e.message : "Try again");
    }
  }, [id]);

  /// Moving something within its day. The API assigns positions in order, so
  /// swapping two is a matter of trading them — no renumbering, and no chance
  /// of two entries claiming the same slot.

  /// Moving a stop to another day.
  ///
  /// It lands at the end of the day it arrives on, which is where the API puts
  /// anything whose position is not stated — and is the right guess, since a
  /// stop dropped on a day has no opinion about what it comes before.
  const moveToDay = useCallback(
    async (item: ItineraryItem, dayIndex: number) => {
      if (item.dayIndex === dayIndex) return;
      const last = (data?.items ?? [])
        .filter((i) => i.dayIndex === dayIndex)
        .reduce((n, i) => Math.max(n, i.position + 1), 0);
      try {
        await api(`/api/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ dayIndex, position: last }),
        });
        reload();
      } catch (e) {
        Alert.alert("Could not move that", e instanceof Error ? e.message : "Try again");
      }
    },
    [data?.items, reload],
  );

  /// Dragging a stop up or down its day.
  ///
  /// PanResponder rather than a gesture library: it is part of React Native, so
  /// this needs no native module and works on the build already on the phone.
  ///
  /// Each row reports its height as it lays out, so the distance dragged can be
  /// turned into a number of rows. Rows are not all the same height — a long
  /// title wraps — so the row being dragged supplies the unit, which is the one
  /// whose height the finger is actually tracking.

  /// The drag in progress. State because the rows are drawn from it, and
  /// mirrored into a ref because the gesture's release handler runs long after
  /// the render that created it and would otherwise close over an old value.
  const [drag, setDrag] = useState<{
    day: number;
    from: number;
    to: number;
    /// Another day being dragged onto, when the finger has left this one.
    onto: number | null;
  } | null>(null);


  const moveTo = useCallback(
    async (day: number, from: number, to: number) => {
      if (from === to) return;
      const sameDay = (data?.items ?? [])
        .filter((i) => i.dayIndex === day)
        .sort((a, b) => a.position - b.position);

      const next = [...sameDay];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);

      try {
        // Renumbered from zero, and only the rows that really moved are sent.
        await Promise.all(
          next
            .map((item, i) =>
              item.position === i
                ? null
                : api(`/api/items/${item.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ position: i }),
                  }),
            )
            .filter(Boolean),
        );
        reload();
      } catch (e) {
        Alert.alert("Could not move that", e instanceof Error ? e.message : "Try again");
      }
    },
    [data?.items, reload],
  );


  if (loading && !data) {
    return (
      <View style={[styles.centre, { backgroundColor: palette.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={[styles.centre, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.muted }}>{error ?? "Trip not found"}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* No bar across the top: the cover is the top of this screen, and it
          carries the title, the dates and the way back itself. */}
      <Stack.Screen options={{ headerShown: false }} />

      {linkDay !== null && data && (
        <AddFromLink
          trip={data.trip}
          days={days}
          activeDay={linkDay}
          initialUrl={shareUrl}
          region={
            (tripRegions(data.trip).length > 0 ? tripRegions(data.trip) : null) ??
            tripRegion(data.items.map((i) => i.place).filter((p) => p !== null))
          }
          onClose={() => setLinkDay(null)}
          onAdded={reload}
        />
      )}

      {/* Keyed by what is being edited, so opening the sheet builds it
          afresh. It is mounted the whole time — it decides for itself whether
          to draw anything — and without a key every field would keep the value
          it was first given, which for a sheet that opens empty means every
          stop opens empty: the wrong day, no place, and a title that saves over
          the real one. */}
      <ItemEditor
        key={
          item
            ? item.mode === "edit"
              ? `edit-${item.item.id}`
              : `new-${item.kind}-${item.dayIndex}`
            : "closed"
        }
        draft={item}
        destination={
          // What the trip says it is, or what its stops say it is.
          // Every place the trip goes to, so a search ranks all of them first
          // rather than only wherever it starts.
          (data && tripRegions(data.trip).length > 0 ? tripRegions(data.trip) : null) ??
          tripRegion((data?.items ?? []).map((i) => i.place).filter((p) => p !== null))
        }
        places={placeData?.places ?? []}
        documents={data?.documents ?? []}
        days={days}
        onClose={() => setItem(null)}
        onSaved={reload}
      />

      {settings && (
        <TripEditor
          trip={data.trip}
          role={data.role}
          onClose={() => setSettings(false)}
          onSaved={(tripId) => {
            // An empty id means it was deleted; there is nothing to go back to.
            if (tripId) reload();
            else router.back();
          }}
        />
      )}
      <Column max={WIDE}>
        <ScrollView style={[styles.fill, { backgroundColor: palette.background }]}>
          <OfflineNote at={offlineAt} />
          <TripCover
            trip={data.trip}
            items={data.items}
            days={days}
            onChanged={reload}
            onEdit={() => setSettings(true)}
          />


          {/* Three lists, not three screens. The counts sit on the tabs because
              something unbooked that has been forgotten about is the only one of
              the three that can cost you anything. */}
          <View style={styles.views}>
            {(
              [
                ["days", "Days", 0],
                ["bookings", "Bookings", toBook],
                ["before", "Before you go", toSort],
                ["files", "Files", (data?.documents ?? []).length],
              ] as const
            ).map(([id, label, count]) => {
              const on = view === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setView(id)}
                  style={[
                    styles.viewTab,
                    { borderColor: on ? palette.primary : palette.border },
                    on && { backgroundColor: palette.primary },
                  ]}
                >
                  <Text style={{ fontSize: 13, color: on ? palette.onPrimary : palette.muted }}>
                    {label}
                    {count > 0 ? ` ${count}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {view === "bookings" && (
            <TripBookings trip={data.trip} items={data.items} onChanged={reload} />
          )}

          {view === "before" && (
            <>
              {/* One table, two lists — split here so neither component has
                  to know the other exists. */}
              <TripResources
                tripId={id}
                resources={(data.resources ?? []).filter((r) => !isPacking(r.kind))}
                onChanged={reload}
              />
              <TripPacking
                tripId={id}
                items={(data.resources ?? []).filter((r) => isPacking(r.kind))}
                startDate={data.trip.startDate}
                otto={Boolean(user?.otto)}
                onChanged={reload}
              />
            </>
          )}

          {view === "files" && (
            <TripFiles tripId={id} files={data.documents ?? []} onChanged={reload} />
          )}

          {view === "days" && (
            <>
          <TripDays
            startDate={data.trip.startDate}
            days={days}
            active={mapDay}
            counts={dayCounts}
            onPick={setMapDay}
          />

          {/* The whole trip's shape, once, above all of its days. A map inside
              each day section would be the better arrangement — and is what a
              single day gets below — but a fortnight would mount fourteen of
              them, and a MapView is not a cheap thing to mount. */}
          {mapDay === null && <TripMap items={data.items} color={data.trip.color} />}

          <PublishPrompt
            tripId={data.trip.id}
            trip={data.trip}
            stops={data.items.length}
            owned={data.role === "owner"}
            onChanged={reload}
          />

          {/* A trip with nothing in it at all. Said once, here, rather than
              under each of fourteen empty days — and only when the trip is
              wholly empty, because a single blank day in a full trip is a gap,
              not a beginning. */}
          {data.items.length === 0 && <OttoSays topic="emptyTrip" />}

          {/* Picking a date shows that day. It used to only move the map, which
              made the calendar look broken: you tap the 20th, the list underneath
              is still every day of the trip, and nothing appears to have
              happened. "Whole trip" is still there for the long view. */}
          {(mapDay === null ? Array.from({ length: days }, (_, d) => d) : [mapDay]).map((day) => {
            const stops = data.items.filter((i) => i.dayIndex === day);
            return (
              <View
                key={day}
                style={styles.day}
                onLayout={(e) =>
                  recordDayBounds(day, e.nativeEvent.layout.y, e.nativeEvent.layout.height)
                }
              >
                <View style={styles.dayHeading}>
                  <View style={styles.dayTitles}>
                    <Text
                      style={[
                        type.section,
                        {
                          color:
                            drag?.onto === day ? palette.accentText : palette.ink,
                        },
                      ]}
                    >
                      Day {day + 1}
                      {drag?.onto === day ? " · drop here" : ""}
                    </Text>
                    {/* What the day is, in one line: how much of it there is and
                        where it goes. The second half only appears when the day
                        actually moves between two places — most days do not, and
                        "Lisbon to Lisbon" says nothing. */}
                    <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
                      {[
                        // Journeys are not stops. A day with two places and a
                        // tram between them is a two-stop day.
                        (() => {
                          const n = stops.filter((i) => i.kind !== "travel").length;
                          return `${n} ${n === 1 ? "stop" : "stops"}`;
                        })(),
                        dayJourney(stops),
                        dayLabel(data.trip, day),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {/* Only when there is something real to say. A day beyond the
                      forecast shows nothing rather than a number to pack from. */}
                  {(() => {
                    const date = data.trip.startDate
                      ? new Date(Date.parse(data.trip.startDate) + day * 86_400_000)
                          .toISOString()
                          .slice(0, 10)
                      : null;
                    const sky = date ? weather.get(date) : undefined;
                    if (!sky) return null;
                    return (
                      <Text style={{ color: palette.muted, fontSize: 12 }}>
                        {condition(sky.code).icon} {sky.high}°/{sky.low}°
                      </Text>
                    );
                  })()}
                </View>

                {mapDay === day && stops.length > 0 && (
                  <TripMap items={stops} color={data.trip.color} />
                )}

                {/* An overnight flight belongs to the evening it left, but the
                    morning it lands is a real part of this day and the one thing
                    on it that cannot move. */}
                {data.items
                  .filter(
                    (i) =>
                      i.kind === "travel" &&
                      i.endDayOffset > 0 &&
                      i.endTime &&
                      i.dayIndex + i.endDayOffset === day,
                  )
                  .map((leg) => (
                    <Text
                      key={`arrives-${leg.id}`}
                      style={{ color: palette.accentText, fontSize: 13, marginTop: 6 }}
                    >
                      ✈️ Lands {leg.endTime}
                      {leg.toPlace ? ` · ${leg.toPlace.name}` : ""}
                      {whoArrivesLabel(leg.arrivals) ? ` — ${whoArrivesLabel(leg.arrivals)}` : ""}
                    </Text>
                  ))}

                {stops.map((entry, index) => {
                  const leg = entry.kind === "travel";
                  const mode = leg ? travelMode(entry.mode) : null;

                  // Made per row so it closes over this row's day and index
                  // rather than over whatever they were when the screen mounted.
                  // PanResponder.create is a plain factory, not a hook.
                  const landingIndex = (dy: number) =>
                    Math.max(0, Math.min(stops.length - 1, index + rowsMoved(day, index, dy)));

                  /// Where the finger is down the page, from where this row
                  /// started plus how far it has travelled.
                  const pageY = (dy: number) =>
                    (dayBounds[day]?.y ?? 0) + (rowOffsets[day]?.[index] ?? 0) + dy;

                  /// The day being dragged over, when it is a different one.
                  /// Dragging within a day is a reorder and stays that way.
                  const overDay = (dy: number) => {
                    const found = dayUnder(pageY(dy));
                    return found === null || found === day ? null : found;
                  };

                  const pan = PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderGrant: () =>
                      setDrag({ day, from: index, to: index, onto: null }),
                    onPanResponderMove: (_event, gesture) => {
                      const onto = overDay(gesture.dy);
                      setDrag({
                        day,
                        from: index,
                        to: onto === null ? landingIndex(gesture.dy) : index,
                        onto,
                      });
                    },
                    // The final distance comes with the release, so where it
                    // lands is worked out from the gesture rather than read back
                    // out of state written by an earlier render.
                    onPanResponderRelease: (_event, gesture) => {
                      setDrag(null);
                      const onto = overDay(gesture.dy);
                      if (onto !== null) void moveToDay(entry, onto);
                      else void moveTo(day, index, landingIndex(gesture.dy));
                    },
                    onPanResponderTerminate: () => setDrag(null),
                  });

                  const held = drag?.day === day && drag.from === index;
                  const target = drag?.day === day && drag.to === index;

                  return (
                    <View
                      key={entry.id}
                      onLayout={(e) => {
                        recordRowHeight(day, index, e.nativeEvent.layout.height);
                        recordRowOffset(day, index, e.nativeEvent.layout.y);
                      }}
                      style={[
                        styles.stop,
                        // A journey is not a card at all. The day reads as a
                        // sequence of places, and the thing that carries you
                        // between two of them is the line between them rather
                        // than another place on the list.
                        leg
                          ? styles.legRow
                          : { backgroundColor: palette.surface, borderColor: palette.border },
                        held && { opacity: 0.4 },
                        target && !held && { borderColor: palette.primary, borderWidth: 2 },
                      ]}
                    >
                      <Pressable
                        style={styles.stopMain}
                        onPress={() => setItem({ mode: "edit", item: entry })}
                      >
                        {leg ? (
                          <Text style={styles.legGlyph}>
                            {entry.emoji || mode?.icon || "→"}
                          </Text>
                        ) : (
                          // The same number the pin on the map above carries, so
                          // the two can be read against each other.
                          <View>
                            <PlaceThumb
                              icon={entry.emoji || stopIconOf(entry)}
                              color={categoryOf(entry.category).color}
                              photoUrl={entry.place?.photoUrl}
                              size={52}
                            />
                            <View style={[styles.stopNumber, { backgroundColor: palette.primary }]}>
                              <Text style={[styles.stopNumberText, { color: palette.onPrimary }]}>
                                {stops.filter((x, i) => i < index && x.kind !== "travel").length + 1}
                              </Text>
                            </View>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.stopTitle, { color: palette.ink }]} numberOfLines={2}>
                            {entry.title}
                          </Text>
                          {(timingLabel(entry) ||
                            entry.notes ||
                            entry.booking ||
                            whoArrivesLabel(entry.arrivals)) && (
                            <Text style={[styles.stopMeta, { color: palette.muted }]} numberOfLines={1}>
                              {[
                                // A journey reads as its times, a stop as how
                                // long it takes; the +1 stays on a flight that
                                // lands the next morning.
                                entry.kind === "travel" && entry.endDayOffset > 0
                                  ? `${timingLabel(entry)} +${entry.endDayOffset}`
                                  : timingLabel(entry),
                                whoArrivesLabel(entry.arrivals),
                                entry.notes,
                                entry.booking === BOOKING_BOOKED ? "booked ✓" : null,
                                entry.booking === BOOKING_NEEDED ? "to book" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          )}
                        </View>
                      </Pressable>

                      <View style={styles.controls}>
                        <View {...pan.panHandlers} hitSlop={8} style={styles.grip}>
                          <Text style={{ color: palette.muted, fontSize: 16 }}>≡</Text>
                        </View>
                        {entry.place && (
                          <Pressable
                            onPress={() =>
                              openDirections(entry.place!.lat, entry.place!.lng, entry.title)
                            }
                            hitSlop={8}
                            accessibilityLabel={`Directions to ${entry.title}`}
                          >
                            {/* The supplied artwork, not a redrawn one — so it
                                keeps its own colours rather than following the
                                row's. 22px because the corner badge is a smudge
                                much below that. */}
                            <Image
                              source={require("../../../assets/images/directions.png")}
                              style={styles.directions}
                            />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}

                {/* A gap in a trip is Otto's moment, and only a gap. With
                    nothing anywhere on the trip he has nothing to read and
                    says so instead — which is what the empty-trip line above
                    is for. Once there is something to work from, he offers. */}
                {stops.length === 0 && data.items.length > 0 && user?.otto && (
                  <AskOtto tripId={id} dayIndex={day} onApplied={reload} />
                )}

                <View style={styles.addRow}>
                  <Pressable
                    onPress={() =>
                      setItem({ mode: "create", tripId: id, dayIndex: day, kind: "stop" })
                    }
                    style={styles.add}
                  >
                    <Text style={{ color: palette.accentText, fontSize: 14 }}>+ Add a stop</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setItem({ mode: "create", tripId: id, dayIndex: day, kind: "travel" })
                    }
                    style={styles.add}
                  >
                    <Text style={{ color: palette.accentText, fontSize: 14 }}>+ Add a journey</Text>
                  </Pressable>
                  {/* The reel is on this phone, so the places should go in from
                      this phone — and onto the day whose button was pressed. */}
                  <Pressable onPress={() => setLinkDay(day)} style={styles.add}>
                    <Text style={{ color: palette.accentText, fontSize: 14 }}>+ From TikTok</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
            </>
          )}

          <Pressable onPress={share} style={styles.share}>
            <Text style={{ color: palette.accentText, fontSize: 14 }}>
              Share a read-only link
            </Text>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Column>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  views: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingTop: 12 },
  viewTab: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  dayChips: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  dayTitles: { flex: 1, minWidth: 0 },
  dayChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  day: { paddingHorizontal: 12, paddingTop: 16 },
  dayHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  /// Sits on the corner of the picture, the way the pin on the map sits on
  /// the place — small, and out of the way of the picture itself.
  stopNumber: {
    position: "absolute",
    top: -5,
    left: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  stopNumberText: { ...type.metaStrong, fontSize: 12, lineHeight: 15 },
  /// No surface and no border — a line of text between two cards.
  legRow: { backgroundColor: "transparent", borderWidth: 0, paddingVertical: 2, marginTop: 6 },
  legGlyph: { fontSize: 15, marginLeft: 4 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  glyph: { fontSize: 18 },
  stopMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  stopTitle: { fontSize: 15 },
  stopMeta: { fontSize: 12, marginTop: 2 },
  grip: { paddingHorizontal: 4, paddingVertical: 2 },
  controls: { flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 10 },
  addRow: { flexDirection: "row", gap: 16 },
  add: { paddingVertical: 10, paddingHorizontal: 4, marginTop: 4 },
  share: { alignItems: "center", paddingVertical: 18, marginTop: 12 },
  directions: { width: 22, height: 22 },
});
