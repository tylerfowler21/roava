import { useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL, api, upload, type ItineraryItem, type Trip, filePart } from "@/lib/api";
import { useAuthHeaders } from "@/lib/use-auth-headers";
import { type } from "@/lib/type";
import { anyPriced, formatMoney, totalOf } from "@/lib/money";
import { formatDay } from "@/lib/dates";

const HEIGHT = 300;

/// "Apr 3 – 9, 2026 · 7 days", and less of it for a trip that has not decided
/// when it happens yet. The year sits at the end rather than on both dates,
/// which is how anybody would write it down.
function whenLine(trip: Trip, days: number) {
  const span = `${days} ${days === 1 ? "day" : "days"}`;
  if (!trip.startDate) return span;
  if (!trip.endDate) return `${formatDay(trip.startDate)} · ${span}`;
  const from = formatDay(trip.startDate, { year: undefined });
  return `${from} – ${formatDay(trip.endDate)} · ${span}`;
}

/// The photograph at the head of a trip, and everything written over it.
///
/// A trip that has had a photograph chosen for it shows that. One that has
/// not borrows a photograph of one of its own stops — usually a picture of
/// the trip in all but name, and it arrives without anybody being asked to
/// find one. Failing both, the trip's own colour, which it has always had.
export default function TripCover({
  trip,
  items,
  days,
  onChanged,
  onEdit,
}: {
  trip: Trip;
  items: ItineraryItem[];
  /// How long the trip runs, which the screen has already worked out.
  days: number;
  /// The trip's cover changed on the server and the screen should re-read it.
  onChanged: () => void;
  /// Open the trip's own settings — the name, the dates, the colour. It used
  /// to be an Edit button in the bar this replaced.
  onEdit: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authHeaders = useAuthHeaders();
  const [busy, setBusy] = useState(false);

  /// The first stop with a photograph, in the order the trip runs.
  const borrowed =
    items.find((i) => i.place?.photoUrl)?.place?.photoUrl ?? null;

  // Nothing is drawn for the tick before the token arrives — see the note on
  // useAuthHeaders. Not the borrowed photo either: swapping one picture for
  // another a moment later reads as a glitch.
  const source = trip.coverUrl
    ? authHeaders
      ? { uri: `${API_URL}${trip.coverUrl}`, headers: authHeaders }
      : null
    : borrowed
      ? { uri: borrowed }
      : null;

  async function choosePhoto() {
    // Imported where it is used rather than at the top of the file: a build
    // without the native module would throw on startup over a button nobody
    // had pressed.
    let ImagePicker: typeof import("expo-image-picker");
    try {
      ImagePicker = await import("expo-image-picker");
    } catch {
      Alert.alert(
        "Photos need a newer build",
        "Choosing a cover was added after the version installed on this phone.",
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos are not shared", "Allow photo access in Settings to choose one.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      // The cover is a wide band across the top, so it is cropped to one here
      // rather than having the middle of a portrait photograph guessed at.
      allowsEditing: true,
      aspect: [3, 2],
    });
    if (picked.canceled) return;

    setBusy(true);
    try {
      const asset = picked.assets[0];
      const form = new FormData();
      form.append("file", filePart(asset.uri, asset.fileName ?? "cover.jpg", asset.mimeType ?? "image/jpeg"));

      await upload(`/api/trips/${trip.id}/cover`, form);
      onChanged();
    } catch (e) {
      Alert.alert("Could not use that photo", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await api(`/api/trips/${trip.id}/cover`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      Alert.alert("Could not remove it", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  function openMenu() {
    // "Use a photo of a stop instead" rather than "Remove": nothing is ever
    // left blank, and saying what happens next is more use than naming the
    // operation.
    const actions: [string, () => void][] = [
      ["Edit trip", onEdit],
      ["Choose a photo", () => void choosePhoto()],
    ];
    if (trip.coverUrl) {
      actions.push(["Use a photo of a stop instead", () => void removePhoto()]);
    }

    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Cancel", ...actions.map(([label]) => label)], cancelButtonIndex: 0 },
      (chosen) => {
        if (chosen > 0) actions[chosen - 1]?.[1]();
      },
    );
  }

  return (
    <View style={[styles.cover, { backgroundColor: trip.color }]}>
      {source && <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" />}

      {/* Dark at the foot, where the title sits, and off the photograph
          higher up. Also behind the buttons at the top, which are otherwise
          a white glyph on whatever the sky happens to be. */}
      <LinearGradient
        colors={["rgba(11,33,28,0.45)", "transparent", "rgba(11,33,28,0.15)", "rgba(11,33,28,0.85)"]}
        locations={[0, 0.28, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.buttons, { top: insets.top + 8 }]}>
        <Round onPress={() => router.back()} label="Back">
          ‹
        </Round>
        <View style={styles.rightButtons}>
          {busy ? (
            <View style={styles.round}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <Round onPress={openMenu} label="Trip photo">
              ⋯
            </Round>
          )}
        </View>
      </View>

      <View style={styles.foot}>
        <Text style={[type.title, styles.title]} numberOfLines={2}>
          {trip.title}
        </Text>
        <Text style={[type.metaStrong, styles.dates]} numberOfLines={1}>
          {[
            whenLine(trip, days),
            // What the plan adds up to so far. Only once something is priced,
            // and deliberately not called a budget: it is the sum of what has
            // been written down, which on a half-planned trip is a floor.
            anyPriced(items) ? formatMoney(totalOf(items), trip.currency) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  );
}

function Round({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={styles.round} hitSlop={6}>
      <Text style={styles.roundGlyph}>{children}</Text>
    </Pressable>
  );
}

/// Fixed colours rather than the palette, as on the sign-in screen: everything
/// here sits on a photograph, so it is in the photograph's light and not the
/// reader's.
const styles = StyleSheet.create({
  cover: { height: HEIGHT, justifyContent: "flex-end", overflow: "hidden" },
  buttons: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  rightButtons: { marginLeft: "auto", flexDirection: "row", gap: 10 },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,33,28,0.38)",
  },
  roundGlyph: { color: "#fff", fontSize: 20, lineHeight: 24 },
  foot: { padding: 20, paddingBottom: 18 },
  title: { color: "#fff", fontSize: 34, lineHeight: 38 },
  dates: { color: "rgba(255,255,255,0.85)", marginTop: 6 },
});
