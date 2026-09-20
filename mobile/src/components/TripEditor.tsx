import { useState } from "react";
import { SEMANTIC } from "@/lib/brand";
import TripPeople from "@/components/TripPeople";
import DateRangePicker from "@/components/DateRangePicker";
import DestinationField from "@/components/DestinationField";
import { tripRegions } from "@/lib/trip-where";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, type Trip } from "@/lib/api";
import { TRIP_COLORS } from "@/lib/theme";
import { regionLabel, regionOfColor } from "@/lib/regions";
import { usePalette } from "@/lib/use-palette";
import { useAuth } from "@/lib/auth";

/// Dates as text rather than a picker.
///
/// A native date picker is two taps and a scroll wheel per date; typing
/// "2026-09-18" is one. It is also what the website's date input produces, so
/// the two agree about what a date looks like. Empty is allowed: a trip is
/// allowed to exist before anyone has decided when it happens.

export default function TripEditor({
  trip,
  role,
  onClose,
  onSaved,
}: {
  /// Null when creating.
  trip: Trip | null;
  /// "owner" for your own trip, "editor" for one you were invited to.
  /// Absent while creating, which only an owner does.
  role?: string;
  onClose: () => void;
  onSaved: (tripId: string) => void;
}) {
  const palette = usePalette();
  const [title, setTitle] = useState(trip?.title ?? "");
  // Seeded from whichever field this trip has: one made before trips could go
  // to more than one place still has only the old one.
  const [destinations, setDestinations] = useState<string[]>(() =>
    trip ? tripRegions(trip) : [],
  );
  const [start, setStart] = useState(trip?.startDate?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(trip?.endDate?.slice(0, 10) ?? "");
  const [color, setColor] = useState(trip?.color ?? TRIP_COLORS[0]);
  const [currency, setCurrency] = useState(trip?.currency ?? "USD");
  const [heads, setHeads] = useState(trip?.headcount?.toString() ?? "");
  const [published, setPublished] = useState(Boolean(trip?.publishedAt));
  const [busy, setBusy] = useState(false);

  const { user } = useAuth();
  const editing = Boolean(trip);
  /// A trip being created has no role yet, and only its owner is creating it.
  const isOwner = !editing || role === "owner";

  async function save() {
    const name = title.trim();
    if (!name) {
      Alert.alert("Give the trip a title");
      return;
    }
    if (start && end && end < start) {
      Alert.alert("Check the dates", "The trip ends before it starts.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        title: name,
        destinations,
        startDate: start || null,
        endDate: end || null,
        color,
        currency,
        headcount: heads.trim() ? Number(heads) : null,
        ...(editing ? { published } : {}),
      };
      const saved = await api<{ trip: Trip }>(
        editing ? `/api/trips/${trip!.id}` : "/api/trips",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      onSaved(saved.trip?.id ?? trip!.id);
      onClose();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert(trip!.title, "Delete this trip and everything in it?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/trips/${trip!.id}`, { method: "DELETE" });
            onSaved("");
            onClose();
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  }

  /// Letting yourself out of somebody else's trip.
  ///
  /// The server has always allowed it — an editor may remove themselves from
  /// the people on a trip — but the app only ever offered the owner's Remove
  /// button, so an editor invited to a trip they no longer wanted was stuck
  /// with it on their list until the owner noticed. The website could do this;
  /// the phone is where you are when you decide.
  ///
  /// A collaborator is recorded against the address they were invited at, so
  /// that is the row to take away.
  function leave() {
    Alert.alert(trip!.title, "Leave this trip? You will not be able to open it again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          const address = user?.email;
          if (!address) {
            Alert.alert("Could not leave", "Sign in again and try that once more.");
            return;
          }
          try {
            await api(
              `/api/trips/${trip!.id}/collaborators?email=${encodeURIComponent(address)}`,
              { method: "DELETE" },
            );
            // The same signal deleting sends: it is gone, so go back rather
            // than returning to a trip that is no longer readable.
            onSaved("");
            onClose();
          } catch (e) {
            Alert.alert("Could not leave", e instanceof Error ? e.message : "Try again");
          }
        },
      },
    ]);
  }

  const field = {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    color: palette.ink,
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.surface }]}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: palette.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: palette.ink }]}>
            {editing ? "Trip settings" : "New trip"}
          </Text>
          <Pressable onPress={save} disabled={busy} hitSlop={10}>
            {busy ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: palette.accentText, fontSize: 16, fontWeight: "600" }}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.body}>
          <Text style={[styles.label, { color: palette.muted }]}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Lisbon, long weekend"
            placeholderTextColor={palette.muted}
            style={[styles.input, field]}
          />

          <Text style={[styles.label, { color: palette.muted }]}>Where it goes</Text>
          <DestinationField value={destinations} onChange={setDestinations} />

          <Text style={[styles.label, { color: palette.muted }]}>When</Text>
          {/* Pointed at rather than typed. A trip with no dates is still a
              trip, so nothing here is required — leave it untouched and the
              trip simply has none. */}
          <DateRangePicker
            start={start}
            end={end}
            onChange={({ start: nextStart, end: nextEnd }) => {
              setStart(nextStart);
              setEnd(nextEnd);
            }}
          />

          <Text style={[styles.label, { color: palette.muted }]}>
            Colour
            {regionLabel(regionOfColor(color)) ? ` — ${regionLabel(regionOfColor(color))}` : ""}
          </Text>
          <View style={styles.colors}>
            {TRIP_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                // Nothing hovers on a phone, so the name of the one that is
                // chosen is shown beside the heading instead, and each swatch
                // says which region it is to anything reading the screen out.
                accessibilityLabel={
                  regionLabel(regionOfColor(c))
                    ? `Use the ${regionLabel(regionOfColor(c))} colour`
                    : `Use colour ${c}`
                }
                accessibilityState={{ selected: color === c }}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  color === c && { borderColor: palette.ink, borderWidth: 3 },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: palette.muted }]}>
            How many people are going
          </Text>
          <TextInput
            value={heads}
            onChangeText={(next) => setHeads(next.replace(/[^\d]/g, "").slice(0, 3))}
            keyboardType="number-pad"
            placeholder="19"
            placeholderTextColor={palette.muted}
            style={[styles.input, { borderColor: palette.border, color: palette.ink }]}
          />
          {/* Heads rather than accounts: five families is five people who can
              log in and nineteen who need tickets, and it is the nineteen a
              per-person price multiplies by. */}
          <Text style={[styles.hint, { color: palette.muted }]}>
            Everybody, not just the people with accounts.
          </Text>

          <Text style={[styles.label, { color: palette.muted }]}>Currency</Text>
          <TextInput
            value={currency}
            onChangeText={(next) => setCurrency(next.toUpperCase().slice(0, 3))}
            autoCapitalize="characters"
            maxLength={3}
            placeholder="USD"
            placeholderTextColor={palette.muted}
            style={[styles.input, { borderColor: palette.border, color: palette.ink }]}
          />
          {/* One per trip, and why. Somebody pricing a week through the
              eurozone and Switzerland picks one and estimates the rest —
              which is what they were doing on paper, and better than a total
              nobody can compute without exchange rates. */}
          <Text style={[styles.hint, { color: palette.muted }]}>
            Everything priced on this trip is in this currency.
          </Text>

          {/* What the colours mean, said once rather than left to be inferred.
              Every colour a trip can be given by where it goes is also one
              somebody can pick by hand, so a row of seven circles is really
              the seven regions — and nothing on screen said so. */}
          <Text style={{ color: palette.muted, fontSize: 12, marginTop: 8 }}>
            Trips are coloured by region — {regionLabel("europe")} blue,{" "}
            {regionLabel("asia")} red, and so on — so the list reads as a map.
            Picking one here overrides that.
          </Text>

          {editing && (
            <View style={[styles.publish, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.ink, fontSize: 15, fontWeight: "500" }}>
                  Published
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
                  Puts it on your profile and in your followers&apos; feeds.
                </Text>
              </View>
              <Switch
                value={published}
                onValueChange={setPublished}
                trackColor={{ true: palette.primary }}
              />
            </View>
          )}

          {/* Who else is on it, and the way to add somebody. It belongs beside
              publishing: both are the same question — who sees this — and this
              is the screen people already open to answer it. */}
          {editing && <TripPeople tripId={trip!.id} />}

          {/* Deleting is the owner's; leaving is everybody else's. Offering
              Delete to an editor was offering a button that could only ever
              answer "only the trip owner can delete this trip". */}
          {editing && (
            <Pressable onPress={isOwner ? remove : leave} style={styles.remove}>
              <Text style={{ color: SEMANTIC.danger, fontWeight: "500" }}>
                {isOwner ? "Delete this trip" : "Leave this trip"}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, marginTop: -4, marginBottom: 4 },
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
  colors: { flexDirection: "row", gap: 12 },
  swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 0, borderColor: "transparent" },
  publish: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 24 },
  remove: { marginTop: 24, alignItems: "center", paddingVertical: 12 },
});
