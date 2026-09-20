import { useEffect, useMemo, useState } from "react";
import { SEMANTIC, RADIUS } from "@/lib/brand";
import {
  DURATIONS,
  durationOf,
  formatDuration,
  parseDuration,
  takesTime,
} from "@/lib/duration";
import { type } from "@/lib/type";
import DateRangePicker from "@/components/DateRangePicker";
import { deadlineLabel, urgencyOf } from "@/lib/booking-deadline";
import SearchMap from "@/components/SearchMap";
import TripFiles from "@/components/TripFiles";
import { useCategories } from "@/lib/categories";
import { usePlaceSearch } from "@/lib/use-place-search";
import { searchPlaces } from "@/lib/search-places";
import { destinationWords, goesTo } from "@/lib/trip-where";
import { parseMoney, toMajorString } from "@/lib/money";
import { currentPosition, nearbyPlaces } from "@/lib/here";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  api,
  type ItineraryItem,
  type Place,
  type SearchResult,
  type TripDocument,
} from "@/lib/api";
import { TRAVEL_MODES } from "@/lib/taxonomy";
import { usePalette } from "@/lib/use-palette";
import { BOOKING_BOOKED, BOOKING_NEEDED, nextState } from "@/lib/bookings";
import { useAuth } from "@/lib/auth";

/// "09:30" — the shape the API stores and the website's time input produces.
const TIME_HINT = "HH:MM";
function isTime(value: string) {
  return value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type ItemDraft =
  | { mode: "create"; tripId: string; dayIndex: number; kind: "stop" | "travel" }
  | { mode: "edit"; item: ItineraryItem };

/// One sheet for a stop and for a leg between two places.
///
/// They are the same row in the same table with a different `kind`, and the
/// itinerary reads as one sequence — a morning, a train, an afternoon. Two
/// separate editors would make them feel like different kinds of thing.
/// Declared here rather than inside the editor: a component defined during
/// render is a different component type each time, so React discards and
/// rebuilds it — losing scroll position and anything else it held.
function PlacePicker({
  label,
  places,
  selected,
  onSelect,
  palette,
}: {
  label: string;
  places: Place[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable
          onPress={() => onSelect(null)}
          style={[
            styles.chip,
            { backgroundColor: palette.surface, borderColor: palette.border },
            !selected && { borderColor: palette.primary },
          ]}
        >
          <Text style={{ fontSize: 13, color: palette.muted }}>None</Text>
        </Pressable>
        {places.map((p) => {
          const on = selected === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p.id)}
              style={[
                styles.chip,
                { backgroundColor: palette.surface, borderColor: palette.border },
                on && { borderColor: palette.primary },
              ]}
            >
              <Text style={{ fontSize: 13, color: on ? palette.ink : palette.muted }} numberOfLines={1}>
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

export default function ItemEditor({
  draft,
  destination,
  places,
  documents,
  days,
  currency,
  onClose,
  onSaved,
}: {
  draft: ItemDraft | null;
  /// Where the trip is, used to narrow the search. Looking for a chain from
  /// inside a trip to Barcelona should not begin with the branch in Chicago.
  destination: string[] | string | null;
  places: Place[];
  /// The trip's files, so a stop can show the ones attached to it.
  documents: TripDocument[];
  /// How many days the trip has, for moving this to another one. Dragging
  /// reaches the days on screen; this reaches the rest.
  days: number;
  /// The trip's currency, which decides how a typed price is read.
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { categories } = useCategories();
  const palette = usePalette();
  const existing = draft?.mode === "edit" ? draft.item : null;

  function remove() {
    if (!existing) return;
    Alert.alert(existing.title, "Remove this from the trip?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/items/${existing.id}`, { method: "DELETE" });
            onSaved();
            onClose();
          } catch (e) {
            Alert.alert(
              "Could not remove that",
              e instanceof Error ? e.message : "Try again",
            );
          }
        },
      },
    ]);
  }
  const kind = existing?.kind ?? (draft?.mode === "create" ? draft.kind : "stop");

  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [emoji, setEmoji] = useState(existing?.emoji ?? "");
  const [dayIndex, setDayIndex] = useState(
    existing?.dayIndex ?? (draft?.mode === "create" ? draft.dayIndex : 0),
  );
  /// What the attached place is currently filed under, so the save can tell
  /// whether the category actually changed and leave it alone if not.
  const existingPlaceCategory = existing?.place?.category ?? null;
  const [category, setCategory] = useState(existing?.category ?? "other");
  /// Whether somebody actually pressed a category, as opposed to the form
  /// simply having one. Without this, opening a stop and saving it unchanged
  /// would file its place under whatever the form defaulted to and quietly
  /// undo what the gazetteer got right.
  const [categoryChosen, setCategoryChosen] = useState(false);
  /// Whether this is something that has to be booked, and whether it has been.
  /// Null for the great majority of stops, which are not bookings at all.
  const [booking, setBooking] = useState<string | null>(existing?.booking ?? null);
  const [bookBy, setBookBy] = useState(existing?.bookBy?.slice(0, 10) ?? "");
  /// Seeded from the duration if there is one, and otherwise from the old
  /// start and end times, so a stop entered before durations existed opens
  /// with the right answer already chosen rather than empty.
  const [minutes, setMinutes] = useState<number | null>(
    existing ? durationOf(existing) : null,
  );
  /// What was typed into "How long?", which is not the same as what it means.
  /// The field stays exactly as written — correcting somebody's typing under
  /// their cursor is maddening — and what it was understood as is shown below
  /// it instead.
  const [legLength, setLegLength] = useState(
    existing?.kind === "travel" && existing.minutes
      ? formatDuration(existing.minutes)?.replace(/^about /, "") ?? ""
      : "",
  );
  const [startTime, setStartTime] = useState(existing?.startTime ?? "");
  const [endTime, setEndTime] = useState(existing?.endTime ?? "");
  /// Whether a journey lands the next day. A tick rather than a number,
  /// because the only case anybody meets is the overnight one.
  const [nextDay, setNextDay] = useState((existing?.endDayOffset ?? 0) > 0);
  const [travelMode, setTravelMode] = useState(existing?.mode ?? "train");
  const [placeId, setPlaceId] = useState(existing?.placeId ?? null);
  const [toPlaceId, setToPlaceId] = useState(existing?.toPlaceId ?? null);
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const tripId =
    draft?.mode === "create" ? draft.tripId : existing?.tripId ?? null;
  const [arrivalUserIds, setArrivalUserIds] = useState<string[]>(
    (existing?.arrivals ?? []).map((p) => p.userId),
  );
  const [party, setParty] = useState<{ userId: string; name: string; image: string | null }[]>([]);

  /// The three things this screen folds away, and whether each is open.
  ///
  /// "More details" opens itself when the stop already uses something inside
  /// it — an icon of its own, a booking — because a setting nobody can see is
  /// worse than a busy screen. The day and the duration always start shut:
  /// both show their answer on the row itself.
  const [showDays, setShowDays] = useState(false);
  const [showDuration, setShowDuration] = useState(false);

  /// What this costs, as typed. Kept as text rather than a number while it is
  /// being edited: a field that reformats under the cursor is one that eats a
  /// digit somebody was halfway through.
  const [costText, setCostText] = useState(
    existing?.costMinor != null ? toMajorString(existing.costMinor, currency) : "",
  );
  const [showMore, setShowMore] = useState(
    Boolean(existing?.emoji || existing?.booking || existing?.bookingRef),
  );

  /// Searching the world, then saving what you pick.
  ///
  /// The pickers below only ever offered places already saved, so planning a
  /// stop somewhere new meant leaving for the map, saving it, and coming back.
  /// This is what the website does: find it, save it, attach it, in one go.
  const [query, setQuery] = useState("");

  /// Places created here, so they appear in the pickers without refetching.
  const [added, setAdded] = useState<Place[]>([]);

  useEffect(() => {
    if (kind !== "travel" || !tripId) return;
    let cancelled = false;
    void (async () => {
      try {
        const body = await api<{
          role: string;
          owner: { id: string; name: string | null; username: string | null; image: string | null } | null;
          collaborators: {
            userId: string | null;
            accepted: boolean;
            name: string | null;
            username: string | null;
            email: string;
            image: string | null;
          }[];
        }>(`/api/trips/${tripId}/collaborators`);
        if (cancelled) return;
        const viewerId = user?.id;
        const you = (id: string, fallback: string) => (id === viewerId ? "You" : fallback);
        const ownerId = body.owner?.id;
        if (!ownerId) {
          setParty([]);
          return;
        }
        const list: { userId: string; name: string; image: string | null }[] = [
          {
            userId: ownerId,
            name: you(
              ownerId,
              body.owner?.name ??
                (body.owner?.username ? `@${body.owner.username}` : "The owner"),
            ),
            image: body.owner?.image ?? null,
          },
        ];
        for (const person of body.collaborators) {
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
        setParty(list);
      } catch {
        // The picker simply stays hidden; the journey can still be saved.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, tripId, user?.id]);

  /// The places worth offering as chips: the ones saved on this trip's
  /// travels, plus anything added here in this sitting.
  ///
  /// Narrowed to where the trip goes, for the same reason the website's list
  /// is: a row of chips beginning with a shop in Tokyo, on a trip to Porto, is
  /// not a row of suggestions. Anything added in this sitting stays whatever
  /// it is — somebody just made it on purpose.
  const whereItGoes = useMemo(() => destinationWords(destination), [destination]);
  const options = [...added, ...places.filter((p) => goesTo(p, whereItGoes))];

  /// Searched as you type, the same as the map tab and the website.
  const { results, searching } = usePlaceSearch(query, (q, mode) =>
    searchPlaces(q, mode, destination),
  );

  /// Whatever is around wherever you are standing, once you have asked.
  ///
  /// The point of having this on a phone: you are in the place, you want it on
  /// today, and typing its name is the long way round when the device already
  /// knows where it is.
  const [around, setAround] = useState<SearchResult[] | null>(null);
  const [locating, setLocating] = useState(false);

  async function findMe() {
    setLocating(true);
    try {
      const position = await currentPosition();
      if (!position.ok) {
        Alert.alert(position.title, position.detail);
        return;
      }
      const found = await nearbyPlaces(position.lat, position.lng);
      setAround(found);
      if (found.length === 0) {
        Alert.alert("Nothing named around here", "Try searching for it instead.");
      }
    } catch {
      Alert.alert("Couldn't look up what's around you", "Try again in a moment.");
    } finally {
      setLocating(false);
    }
  }

  /// The ones where this trip is, with everything else folded away.
  const here = results.filter((r) => r.nearby);
  const elsewhere = results.filter((r) => !r.nearby);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const shownResults = destination && here.length > 0 && !showElsewhere ? here : results;

  /// Saved as somewhere you want to go: it is on an itinerary, which is a plan
  /// rather than a record. Marking it visited is a thing you do afterwards.
  async function saveAndAttach(result: SearchResult, target: "from" | "to") {
    Keyboard.dismiss();
    try {
      const { place } = await api<{ place: Place }>("/api/places", {
        method: "POST",
        body: JSON.stringify({
          name: result.name,
          lat: result.lat,
          lng: result.lng,
          category: result.category,
          status: "wishlist",
          address: result.address,
          city: result.city,
          country: result.country,
          countryCode: result.countryCode,
        }),
      });
      setAdded((current) => [place, ...current]);
      if (target === "to") {
        setToPlaceId(place.id);
        if (!title.trim()) setTitle(result.name);
      } else {
        // The same three answers a saved place gives, for one just found.
        adopt(place);
      }
      setQuery("");
    } catch (e) {
      Alert.alert("Could not save that place", e instanceof Error ? e.message : "Try again");
    }
  }

  /// The place on this stop, whichever list it came from: one saved here a
  /// moment ago, one already in the trip's library, or the one the item was
  /// loaded with.
  const attached =
    options.find((p) => p.id === placeId) ??
    (existing?.placeId && existing.placeId === placeId ? existing.place : null);
  const attachedIcon =
    emoji.trim() ||
    attached?.emoji ||
    categories.find((c) => c.id === (attached?.category ?? category))?.icon ||
    "📍";

  /// Picking a place answers three questions at once.
  ///
  /// A stop at Café de Flore is called Café de Flore, is a café, and looks
  /// like one. Setting those by hand afterwards was the main reason anybody
  /// ever opened the category row — and all three stay editable underneath.
  function adopt(place: Place | null) {
    setPlaceId(place?.id ?? null);
    if (!place) return;
    // A journey is not called after the city it leaves — "Montreal" is a poor
    // name for the train to Quebec, and it is the wrong end of it besides. Its
    // look is settled too: every journey is filed as transport and wears the
    // icon of how it travels.
    if (kind === "travel") return;
    setTitle(place.name);
    if (place.category) {
      setCategory(place.category);
      setCategoryChosen(false);
    }
    if (place.emoji) setEmoji(place.emoji);
  }

  function attachSaved(id: string | null) {
    adopt(id ? (options.find((p) => p.id === id) ?? null) : null);
  }

  if (!draft) return null;
  const travel = kind === "travel";
  const flightLike = travel && !takesTime({ kind, mode: travelMode });

  async function save() {
    const name = title.trim();
    if (!name) {
      Alert.alert("Give it a title");
      return;
    }
    // Only a journey has times to check. A stop's duration comes from a list
    // and cannot be mistyped.
    if (travel && (!isTime(startTime) || !isTime(endTime))) {
      Alert.alert("Check the times", `Use ${TIME_HINT}, or leave them empty.`);
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: name,
        kind,
        notes: notes.trim() || null,
        emoji: emoji.trim() || null,
        category: travel ? "transport" : category,
        startTime: travel ? startTime || null : null,
        endTime: travel ? endTime || null : null,
        // A flight is the one journey whose clock times are the fact.
        minutes: travel ? (flightLike ? null : parseDuration(legLength)) : minutes,
        endDayOffset: travel && endTime && nextDay ? 1 : 0,
        // An emptied box means "nobody has priced this", which is not the
        // same as free — so it saves null rather than zero.
        costMinor: costText.trim() ? parseMoney(costText, currency) : null,
        mode: travel ? travelMode : null,
        placeId,
        toPlaceId: travel ? toPlaceId : null,
        booking,
        // A deadline only means anything while something is still to be
        // booked. Booked, or no longer a booking at all, and it is a date to
        // be reminded about for no reason.
        bookBy: booking === BOOKING_NEEDED && bookBy ? bookBy : null,
        // Clearing the booking clears what was booked with it; a reference to
        // a reservation nobody is making any more is just a stale number.
        ...(booking === null ? { bookingRef: null } : {}),
        ...(travel ? { arrivalUserIds } : {}),
      };
      if (draft!.mode === "create") {
        await api(`/api/trips/${draft!.tripId}/items`, {
          method: "POST",
          body: JSON.stringify({ ...body, dayIndex }),
        });
      } else {
        await api(`/api/items/${draft!.item.id}`, {
          method: "PATCH",
          // Sent on every save, so changing the day here is all it takes. The
          // API drops it at the end of whichever day it arrives on.
          body: JSON.stringify({ ...body, dayIndex }),
        });
      }

      // A stop that has a place takes its icon from the place, not from the
      // stop — so setting the category here and stopping there would leave a
      // restaurant showing the aeroplane a gazetteer guessed. Picking a
      // category for somewhere with a place means that place is a restaurant,
      // the same way its emoji already applies everywhere.
      if (!travel && placeId && categoryChosen && category !== existingPlaceCategory) {
        await api(`/api/places/${placeId}`, {
          method: "PATCH",
          body: JSON.stringify({ category }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  const field = {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    color: palette.ink,
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.surface }]}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: palette.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.ink }]}>
            {travel ? "Journey" : "Stop"}
          </Text>
          <Pressable onPress={save} disabled={busy} hitSlop={10}>
            {busy ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: palette.accentText, fontSize: 16, fontWeight: "600" }}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={{ backgroundColor: palette.background }}
          contentContainerStyle={styles.body}
          // Without this iOS spends the first tap dismissing the keyboard and
          // never delivers it, so picking a search result took two taps and the
          // first one looked like nothing happening. Scrolling still puts the
          // keyboard away, which is the gesture it was standing in for.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* ---- What ------------------------------------------------- */}

          <Text style={[styles.label, { color: palette.muted }]}>
            {travel ? "What journey?" : "What are you doing?"}
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={travel ? "Train to Porto" : "Lunch at the market"}
            placeholderTextColor={palette.muted}
            style={[styles.input, field]}
          />

          {travel && (
            <>
              <Text style={[styles.label, { color: palette.muted }]}>How</Text>
              <View style={styles.chips}>
                {TRAVEL_MODES.map((m) => {
                  const on = travelMode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => setTravelMode(m.id)}
                      style={[
                        styles.chip,
                        { backgroundColor: palette.surface, borderColor: palette.border },
                        on && { borderColor: palette.primary },
                      ]}
                    >
                      <Text style={{ fontSize: 13, color: on ? palette.ink : palette.muted }}>
                        {m.icon} {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* The place this is at.

              Once one is attached there is nothing left to ask, so the search
              field, the saved-place row and "I'm here now" — three controls all
              asking the same question — fold away behind the answer. Tapping ×
              brings them back. */}
          {!travel && attached ? (
            <View
              style={[
                styles.attached,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              <Text style={{ fontSize: 20 }}>{attachedIcon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.ink, fontSize: 15 }} numberOfLines={1}>
                  {attached.name}
                </Text>
                {attached.city && (
                  <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                    {attached.city}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => setPlaceId(null)} hitSlop={10}>
                <Text style={{ color: palette.muted, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.label, { color: palette.muted }]}>
                {travel ? "Search anywhere — saves it and attaches it" : "Which place?"}
              </Text>
              <View style={styles.searchRow}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={() => Keyboard.dismiss()}
                  returnKeyType="search"
                  placeholder="Paris, Sagrada Família…"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, { flex: 1 }, field]}
                />
                {searching && <ActivityIndicator />}
              </View>

              <Pressable
                onPress={() => void findMe()}
                disabled={locating}
                style={[styles.hereButton, { borderColor: palette.border, opacity: locating ? 0.5 : 1 }]}
              >
                <Text style={{ color: palette.accentText, fontSize: 14, fontWeight: "500" }}>
                  {locating ? "Finding you…" : "📍 I'm here now"}
                </Text>
              </Pressable>

              {/* Where the matches are, numbered to match the rows. This sheet
                  covers the trip's own map completely, so without it a list of
                  four identical names is all anybody gets. */}
              <SearchMap results={around ?? shownResults} />

              {around !== null && around.length > 0 && (
                <View style={styles.aroundHeader}>
                  <Text style={{ color: palette.muted, fontSize: 12, flex: 1 }}>Around you</Text>
                  <Pressable onPress={() => setAround(null)} hitSlop={8}>
                    <Text style={{ color: palette.muted, fontSize: 12 }}>clear</Text>
                  </Pressable>
                </View>
              )}

              {(around ?? []).map((r, n) => (
                <View
                  key={`near-${r.id}`}
                  style={[styles.result, { borderColor: palette.border, backgroundColor: palette.surface }]}
                >
                  <View style={styles.resultHead}>
                    <View style={[styles.resultNumber, { backgroundColor: palette.accent }]}>
                      <Text style={[type.metaStrong, { color: palette.onAccent, fontSize: 11 }]}>
                        {n + 1}
                      </Text>
                    </View>
                    <Text style={{ color: palette.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </View>
                  <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                    {r.address ?? r.city ?? ""}
                  </Text>
                  <View style={styles.resultActions}>
                    <Pressable
                      onPress={async () => {
                        await saveAndAttach(r, "from");
                        setAround(null);
                      }}
                      hitSlop={6}
                    >
                      <Text style={{ color: palette.accentText, fontWeight: "600", fontSize: 13 }}>
                        {travel ? "Leaving from here" : "Use this place"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              {shownResults.map((r, n) => (
                <View
                  key={r.id}
                  style={[styles.result, { borderColor: palette.border, backgroundColor: palette.surface }]}
                >
                  <View style={styles.resultHead}>
                    {/* The number on the pin above. */}
                    <View style={[styles.resultNumber, { backgroundColor: palette.accent }]}>
                      <Text style={[type.metaStrong, { color: palette.onAccent, fontSize: 11 }]}>
                        {n + 1}
                      </Text>
                    </View>
                    <Text style={{ color: palette.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </View>
                  <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                    {r.context}
                  </Text>
                  <View style={styles.resultActions}>
                    <Pressable onPress={() => saveAndAttach(r, "from")} hitSlop={6}>
                      <Text style={{ color: palette.accentText, fontWeight: "600", fontSize: 13 }}>
                        {travel ? "Leaving from here" : "Use this place"}
                      </Text>
                    </Pressable>
                    {travel && (
                      <Pressable onPress={() => saveAndAttach(r, "to")} hitSlop={6}>
                        <Text style={{ color: palette.accentText, fontWeight: "600", fontSize: 13 }}>
                          Arriving here
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}

              {destination && here.length > 0 && elsewhere.length > 0 && (
                <Pressable onPress={() => setShowElsewhere((v) => !v)} hitSlop={8}>
                  <Text style={{ color: palette.muted, fontSize: 12, paddingVertical: 8 }}>
                    {showElsewhere
                      ? `Just the ones in ${destination}`
                      : `${elsewhere.length} more elsewhere in the world`}
                  </Text>
                </Pressable>
              )}

              <PlacePicker
                label={travel ? "Leaving from" : "Or one you've saved"}
                places={options}
                selected={placeId}
                onSelect={attachSaved}
                palette={palette}
              />
            </>
          )}

          {travel && (
            <PlacePicker
              label="Arriving at"
              places={options}
              selected={toPlaceId}
              onSelect={setToPlaceId}
              palette={palette}
            />
          )}

          {/* ---- When ------------------------------------------------- */}

          <Text style={[styles.label, { color: palette.muted }]}>When</Text>

          {/* A row that says which day, rather than one chip per day. On a
              fortnight that was fourteen chips wrapping over three lines,
              given the same weight as everything else on the screen. */}
          <Pressable
            onPress={() => setShowDays((v) => !v)}
            style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}
          >
            <Text style={{ color: palette.ink, fontSize: 15, flex: 1 }}>
              Day {dayIndex + 1}
              <Text style={{ color: palette.muted }}> of {Math.max(days, dayIndex + 1)}</Text>
            </Text>
            <Text style={{ color: palette.muted, fontSize: 15 }}>{showDays ? "Done" : "Change"}</Text>
          </Pressable>

          {showDays && (
            <View style={[styles.dayChips, { marginTop: 8 }]}>
              {Array.from({ length: Math.max(days, dayIndex + 1) }, (_, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    setDayIndex(i);
                    setShowDays(false);
                  }}
                  style={[
                    styles.dayChip,
                    { borderColor: dayIndex === i ? palette.primary : palette.border },
                  ]}
                >
                  <Text style={{ fontSize: 13, color: palette.ink }}>Day {i + 1}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {travel ? (
            <>
              {/* Only a flight is known by its clock. A train, a drive or a
                  ferry is known as "about two hours" long before anybody knows
                  which train. An open field rather than a list, because the
                  list was drawn for stops and journeys run from a ten-minute
                  walk to a fourteen-hour drive. */}
              {!flightLike && (
                <>
                  <Text style={[styles.label, { color: palette.muted }]}>How long?</Text>
                  <TextInput
                    value={legLength}
                    onChangeText={setLegLength}
                    placeholder="2h 15m"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, field]}
                  />
                  <Text
                    style={{
                      color: legLength.trim() && !parseDuration(legLength)
                        ? SEMANTIC.danger
                        : palette.muted,
                      fontSize: 12,
                      marginTop: 4,
                    }}
                  >
                    {legLength.trim() === ""
                      ? "However you'd say it — 2h, 90 min, 1:45."
                      : parseDuration(legLength)
                        ? `Understood as ${formatDuration(parseDuration(legLength))}.`
                        : "Not understood — try 2h, 90 min or 1:45."}
                  </Text>
                </>
              )}
              <View style={styles.times}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: palette.muted }]}>Departs</Text>
                  <TextInput
                    value={startTime}
                    onChangeText={setStartTime}
                    placeholder={TIME_HINT}
                    placeholderTextColor={palette.muted}
                    keyboardType="numbers-and-punctuation"
                    style={[styles.input, field]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: palette.muted }]}>Arrives</Text>
                  <TextInput
                    value={endTime}
                    onChangeText={setEndTime}
                    placeholder={TIME_HINT}
                    placeholderTextColor={palette.muted}
                    keyboardType="numbers-and-punctuation"
                    style={[styles.input, field]}
                  />
                </View>
              </View>

              {/* Offered once there is an arrival to qualify. Suggested when
                  the clock appears to run backwards, which is exactly what a
                  flight east across the Atlantic looks like. */}
              {endTime.trim().length > 0 && (
                <>
                  <Pressable onPress={() => setNextDay((on) => !on)} style={styles.check}>
                    <Text style={{ fontSize: 18 }}>{nextDay ? "☑️" : "⬜️"}</Text>
                    <Text style={{ color: palette.ink, fontSize: 14 }}>Lands the next day</Text>
                  </Pressable>
                  {!nextDay && startTime.trim() !== "" && endTime.trim() <= startTime.trim() && (
                    <Text style={{ color: SEMANTIC.danger, fontSize: 12, marginTop: 4 }}>
                      Arrival is before departure — this probably lands the next day.
                    </Text>
                  )}
                </>
              )}

              {party.length >= 2 && (
                <>
                  <Text style={[styles.label, { color: palette.muted }]}>Who&apos;s arriving</Text>
                  <Text style={{ color: palette.muted, fontSize: 12, marginBottom: 6 }}>
                    Optional — leave empty if it&apos;s everyone, or if it doesn&apos;t matter.
                  </Text>
                  <View style={styles.chips}>
                    {party.map((person) => {
                      const on = arrivalUserIds.includes(person.userId);
                      return (
                        <Pressable
                          key={person.userId}
                          onPress={() =>
                            setArrivalUserIds((ids) =>
                              on ? ids.filter((id) => id !== person.userId) : [...ids, person.userId],
                            )
                          }
                          style={[
                            styles.chip,
                            { backgroundColor: palette.surface, borderColor: palette.border },
                            on && { borderColor: palette.primary },
                          ]}
                        >
                          <Text style={{ fontSize: 13, color: on ? palette.ink : palette.muted }}>
                            {person.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              {/* Nobody plans a temple for 14:30 to 16:15, and a plan that
                  claims to is wrong by mid-morning — so a stop says roughly how
                  long it eats, and most stops never say at all. */}
              <Pressable
                onPress={() => setShowDuration((v) => !v)}
                style={[
                  styles.row,
                  { borderColor: palette.border, backgroundColor: palette.surface, marginTop: 8 },
                ]}
              >
                <Text style={{ color: palette.ink, fontSize: 15, flex: 1 }}>
                  How long?
                  <Text style={{ color: palette.muted }}>
                    {"  "}
                    {formatDuration(minutes) ?? "not set"}
                  </Text>
                </Text>
                <Text style={{ color: palette.muted, fontSize: 15 }}>
                  {showDuration ? "Done" : "Change"}
                </Text>
              </Pressable>

              {showDuration && (
                <View style={styles.durations}>
                  {DURATIONS.map((m) => {
                    const on = minutes === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setMinutes(on ? null : m)}
                        style={[
                          styles.duration,
                          { borderColor: on ? palette.primary : palette.border },
                          on && { backgroundColor: palette.primary },
                        ]}
                      >
                        <Text
                          style={[type.meta, { color: on ? palette.onPrimary : palette.ink }]}
                        >
                          {formatDuration(m)?.replace(/^about /, "")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* ---- Notes ------------------------------------------------ */}

          {/* What you wrote about the place itself, on your own map.

              Two different notes have always existed — one about the place,
              which follows it onto every trip it is ever on, and one about
              this stop on this day. Only the second was ever shown here, so a
              note written on the map looked lost the moment the place was
              added to a trip.

              Read-only, and said to belong to the place: editing it here would
              put two note fields side by side with no way to tell which one
              you were changing. */}
          {existing?.place?.notes && (
            <>
              <Text style={[styles.label, { color: palette.muted }]}>
                Your note on {existing.place.name}
              </Text>
              <View
                style={[
                  styles.placeNote,
                  { borderColor: palette.border, backgroundColor: palette.surface },
                ]}
              >
                <Text style={{ color: palette.ink, fontSize: 14, lineHeight: 19 }}>
                  {existing.place.notes}
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12, marginTop: 6 }}>
                  On the place, so it shows on every trip it is on. Change it
                  from the map.
                </Text>
              </View>
            </>
          )}

          <Text style={[styles.label, { color: palette.muted }]}>
            What it costs ({currency})
          </Text>
          <TextInput
            value={costText}
            onChangeText={setCostText}
            keyboardType="decimal-pad"
            placeholder="Leave empty if you don't know yet"
            placeholderTextColor={palette.muted}
            style={[styles.input, field]}
          />

          <Text style={[styles.label, { color: palette.muted }]}>
            {existing?.place?.notes ? "Notes for this stop" : "Notes"}
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Seat 12A, platform 3…"
            placeholderTextColor={palette.muted}
            style={[styles.input, styles.notes, field]}
          />

          {/* ---- Everything else -------------------------------------- */}

          {/* The category, the icon, the files and whether it needs booking.
              All four matter and none is asked on most stops: a place brings
              its own category and icon, and the great majority of stops are
              not bookings. They were four sections of a thirteen-section
              screen, given the same weight as the title.

              Opened already when this stop actually uses one of them, so
              nothing anybody set can hide behind a row they never tap. */}
          <Pressable
            onPress={() => setShowMore((v) => !v)}
            style={[
              styles.row,
              { borderColor: palette.border, backgroundColor: palette.surface, marginTop: 18 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.ink, fontSize: 15 }}>More details</Text>
              {!showMore && (
                <Text style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
                  {[!travel && "category", "icon", draft?.mode === "edit" && "files", "booking"]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
            </View>
            <Text style={{ color: palette.muted, fontSize: 18 }}>{showMore ? "⌃" : "⌄"}</Text>
          </Pressable>

          {showMore && (
            <>
              {!travel && (
                <>
                  <Text style={[styles.label, { color: palette.muted }]}>Category</Text>
                  <View style={styles.chips}>
                    {categories.map((c) => {
                      const on = category === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => {
                            setCategory(c.id);
                            setCategoryChosen(true);
                          }}
                          style={[
                            styles.chip,
                            { backgroundColor: palette.surface, borderColor: palette.border },
                            on && { borderColor: c.color },
                          ]}
                        >
                          <Text style={{ fontSize: 13, color: on ? palette.ink : palette.muted }}>
                            {c.icon} {c.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={[styles.label, { color: palette.muted }]}>
                Icon — leave empty to use the category&apos;s
              </Text>
              <TextInput
                value={emoji}
                onChangeText={setEmoji}
                placeholder="🚂"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.emoji, field]}
              />

              {/* The confirmation, on the thing it confirms. The trip's Files
                  tab shows it too — the same list, read from the stop it
                  belongs to. */}
              {draft?.mode === "edit" && (
                <>
                  <Text style={[styles.label, { color: palette.muted }]}>Files</Text>
                  <TripFiles
                    tripId={draft.item.tripId}
                    files={documents}
                    itemId={draft.item.id}
                    onChanged={onSaved}
                  />
                </>
              )}

              {/* The tick that puts this on the trip's bookings tab, and takes
                  it off again. Nothing is a booking until somebody says so. */}
              <Pressable
                onPress={() => setBooking(booking === null ? BOOKING_NEEDED : null)}
                style={styles.check}
              >
                <Text style={{ fontSize: 18 }}>{booking === null ? "⬜️" : "☑️"}</Text>
                <Text style={{ color: palette.ink, fontSize: 14 }}>Needs booking</Text>
              </Pressable>

              {booking !== null && (
                <Pressable
                  onPress={() => setBooking(nextState(booking))}
                  style={[styles.check, { marginLeft: 22 }]}
                >
                  <Text style={{ fontSize: 18 }}>
                    {booking === BOOKING_BOOKED ? "☑️" : "⬜️"}
                  </Text>
                  <Text style={{ color: palette.ink, fontSize: 14 }}>Booked</Text>
                </Pressable>
              )}

              {/* The deadline the spreadsheet used to carry as "book 3 days
                  before" — a note nothing could act on. */}
              {booking === BOOKING_NEEDED && (
                <>
                  <Text style={[styles.label, { color: palette.muted }]}>Book by</Text>
                  <DateRangePicker
                    single
                    start={bookBy}
                    end=""
                    onChange={({ start }) => setBookBy(start)}
                  />
                  {bookBy !== "" && (
                    <Text
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        color:
                          urgencyOf(bookBy) === "overdue"
                            ? SEMANTIC.danger
                            : urgencyOf(bookBy) === "soon"
                              ? SEMANTIC.warning
                              : palette.muted,
                      }}
                    >
                      {deadlineLabel(bookBy)}
                    </Text>
                  )}
                </>
              )}
            </>
          )}
          {/* Taking something off the trip belongs with editing it, not on the
              row. The row used to carry the only × there was, which meant the
              list could never be the clean thing the kit draws. */}
          {existing && (
            <Pressable onPress={remove} style={styles.remove}>
              <Text style={{ color: SEMANTIC.danger, fontSize: 15 }}>
                Remove from trip
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16, fontWeight: "600" },
  body: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 18, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  emoji: { width: 90, fontSize: 22 },
  durations: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  duration: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  remove: { alignItems: "center", paddingVertical: 18, marginTop: 6 },
  notes: { minHeight: 80, textAlignVertical: "top" },
  placeNote: { borderWidth: 1, borderRadius: RADIUS.card, padding: 12 },
  /// A line that states its answer and opens to change it.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  /// The place, once one is attached.
  attached: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: 12,
    marginTop: 12,
  },
  check: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  dayChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  times: { flexDirection: "row", gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingRight: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hereButton: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 11,
    marginTop: 10,
  },
  aroundHeader: { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 4 },
  result: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  resultHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resultActions: { flexDirection: "row", gap: 20, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 200 },
});
