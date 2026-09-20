import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type TripWant } from "@/lib/api";
import { type } from "@/lib/type";
import { usePalette } from "@/lib/use-palette";

/// What everyone on a trip says they want out of it.
///
/// A trip with five families on it has one organiser and nineteen other
/// opinions, and the itinerary is the wrong place for them: it is editable by
/// everybody, which sounds like collaboration and works like a scrum. This is
/// the quiet half — say what you would like, see what everyone else said, and
/// let whoever is building the days read the lot.
///
/// Attributed always, because an unattributed wish list is a suggestion box.
/// Yours to remove, or the owner's.

export default function TripWants({
  tripId,
  wants,
  me,
  isOwner,
  onChanged,
}: {
  tripId: string;
  wants: TripWant[];
  /// The current user's id, so the list knows which rows are theirs.
  me: string | null;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const palette = usePalette();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = wants.filter((w) => w.userId === me).length;

  async function add() {
    const what = label.trim();
    if (!what || busy) return;
    setBusy(true);
    setLabel("");
    try {
      await api(`/api/trips/${tripId}/wants`, {
        method: "POST",
        body: JSON.stringify({ label: what }),
      });
      onChanged();
    } catch {
      setLabel(what);
    } finally {
      setBusy(false);
    }
  }

  async function remove(want: TripWant) {
    try {
      await api(`/api/wants/${want.id}`, { method: "DELETE" });
      onChanged();
    } catch {
      // Left where it is. Nothing was lost and the row is still tappable.
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <Text style={[type.item, { color: palette.ink }]}>What everyone wants</Text>
        {wants.length > 0 && (
          <Text style={[type.meta, { color: palette.muted }]}>
            {wants.length} {wants.length === 1 ? "idea" : "ideas"}
          </Text>
        )}
      </View>

      {wants.length === 0 ? (
        <Text style={[type.meta, { color: palette.muted }]}>
          Everyone on this trip can add what they&apos;d like to do. Whoever
          builds the days gets to see the lot.
        </Text>
      ) : (
        wants.map((want) => {
          const yours = want.userId === me;
          const who =
            want.user.name ?? (want.user.username ? `@${want.user.username}` : "Someone");
          return (
            <View key={want.id} style={[styles.row, { borderBottomColor: palette.border }]}>
              <View style={styles.words}>
                <Text style={[type.body, { color: palette.ink }]}>{want.label}</Text>
                <Text style={[type.meta, { color: palette.muted }]}>{yours ? "You" : who}</Text>
              </View>
              {(yours || isOwner) && (
                <Pressable onPress={() => void remove(want)} hitSlop={8}>
                  <Text style={[type.meta, { color: palette.muted }]}>Remove</Text>
                </Pressable>
              )}
            </View>
          );
        })
      )}

      <TextInput
        style={[
          styles.field,
          { borderColor: palette.border, color: palette.ink, backgroundColor: palette.surface },
        ]}
        placeholder={
          mine === 0 ? "What would make this trip worth it for you?" : "Anything else?"
        }
        placeholderTextColor={palette.muted}
        value={label}
        onChangeText={setLabel}
        onSubmitEditing={() => void add()}
        maxLength={120}
        blurOnSubmit={false}
        returnKeyType="done"
        editable={!busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: 20 },
  heading: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  words: { flex: 1, gap: 2 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
});
