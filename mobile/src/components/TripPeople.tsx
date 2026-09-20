/// Who else can edit this trip.
///
/// The website has had this since trips could be shared; the app could open a
/// trip somebody had invited you to but never say who else was on it, and
/// never let you invite anyone. So a trip planned together had to be set up at
/// a laptop before it could be used on a phone, which is the wrong way round —
/// the phone is where you are when you remember to add someone.
///
/// An invitation is addressed to an email rather than to an account, so you
/// can invite somebody who has not signed up yet; it binds to them when they
/// first open the trip. Until then they show as invited rather than as here.
/// People you already follow can be invited by username, so you never have to
/// remember their address.
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, type Person } from "@/lib/api";
import { RADIUS, SEMANTIC } from "@/lib/brand";
import { type } from "@/lib/type";
import { useApi } from "@/lib/use-api";
import { usePalette } from "@/lib/use-palette";

type Collaborator = {
  email: string;
  role: string;
  accepted: boolean;
  userId: string | null;
  name: string | null;
  image: string | null;
  username: string | null;
};

type Owner = { id?: string; name: string | null; username: string | null; image: string | null } | null;
type People = { role: string; owner: Owner; collaborators: Collaborator[] };

/// Enough of an address to be worth sending to. The server checks it properly;
/// this only decides whether the button is worth offering.
function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function personLabel(person: { name: string | null; username: string | null; email?: string }) {
  return person.name ?? (person.username ? `@${person.username}` : (person.email ?? "them"));
}

export default function TripPeople({ tripId }: { tripId: string }) {
  const palette = usePalette();
  // The same hook every other screen reads through: it cancels a response that
  // lands after this is gone, and signs out on a lapsed token rather than
  // failing forever.
  const { data: people, loading, error, reload } = useApi<People>(
    `/api/trips/${tripId}/collaborators`,
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = people?.role === "owner";
  /// The owner is not a collaborator row — they are the trip — but a list of
  /// who can edit that leaves them out is a strange list.
  const ownerLabel =
    people?.owner?.name ??
    (people?.owner?.username ? `@${people.owner.username}` : null) ??
    (isOwner ? "You" : "The owner");

  async function inviteByEmail() {
    const address = email.trim().toLowerCase();
    if (!looksLikeEmail(address)) {
      Alert.alert("Check that address", "It needs to look like an email address.");
      return;
    }
    setBusy(true);
    Keyboard.dismiss();
    try {
      const body = await api<{ emailed?: boolean }>(
        `/api/trips/${tripId}/collaborators`,
        { method: "POST", body: JSON.stringify({ email: address }) },
      );
      setEmail("");
      reload();
      // The invitation is recorded either way. Whether the email actually went
      // is a separate question, and one they need answering — otherwise they
      // wait for a reply to a message nobody received.
      if (body.emailed === false) {
        Alert.alert(
          "Invited, but no email went out",
          `${address} can open the trip once they sign in, but you'll have to tell them yourself.`,
        );
      }
    } catch (e) {
      Alert.alert("Could not invite them", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  async function inviteByUsername(username: string, label: string) {
    setBusy(true);
    try {
      const body = await api<{ emailed?: boolean; collaborator?: Collaborator }>(
        `/api/trips/${tripId}/collaborators`,
        { method: "POST", body: JSON.stringify({ username }) },
      );
      reload();
      if (body.emailed === false) {
        const who = body.collaborator ? personLabel(body.collaborator) : label;
        Alert.alert(
          "Invited, but no email went out",
          `${who} can open the trip once they sign in, but you'll have to tell them yourself.`,
        );
      }
    } catch (e) {
      Alert.alert("Could not invite them", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  function remove(person: Collaborator) {
    const name = person.name ?? person.email;
    Alert.alert(
      `Remove ${name}?`,
      "They lose access to this trip. Nothing they added to it is removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api(
                `/api/trips/${tripId}/collaborators?email=${encodeURIComponent(person.email)}`,
                { method: "DELETE" },
              );
              reload();
            } catch (e) {
              Alert.alert("Could not remove them", e instanceof Error ? e.message : "Try again");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (loading && !people) return <ActivityIndicator style={{ marginTop: 12 }} />;
  // A trip you can open always has an answer here. If it somehow does not,
  // a red line above the itinerary helps nobody — the section just stays away.
  if (error || !people) return null;

  return (
    <>
      <Text style={[styles.label, { color: palette.muted }]}>Who can edit this</Text>

      <View style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        {people.owner?.image ? (
          <Image source={{ uri: people.owner.image }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: palette.border }]}>
            <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "600" }}>
              {ownerLabel.replace("@", "").charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[type.item, { color: palette.ink }]} numberOfLines={1}>
            {ownerLabel}
          </Text>
          <Text style={[type.meta, { color: palette.muted }]}>
            {isOwner ? "Owner — you" : "Owner"}
          </Text>
        </View>
      </View>

      {people.collaborators.map((person) => (
        <View
          key={person.email}
          style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}
        >
          {person.image ? (
            <Image source={{ uri: person.image }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: palette.border }]}>
              <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "600" }}>
                {(person.name ?? person.email).charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[type.item, { color: palette.ink }]} numberOfLines={1}>
              {person.name ?? person.email}
            </Text>
            <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
              {person.accepted ? "Can edit" : "Invited — hasn't opened it yet"}
            </Text>
          </View>
          {/* The owner can remove anyone; anybody else may only let themselves
              out, and the server enforces that rather than trusting this. */}
          {isOwner && (
            <Pressable onPress={() => remove(person)} disabled={busy} hitSlop={8}>
              <Text style={{ color: SEMANTIC.danger, fontSize: 13 }}>Remove</Text>
            </Pressable>
          )}
        </View>
      ))}

      {isOwner && (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Name, username, or email address"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => {
              if (looksLikeEmail(email)) void inviteByEmail();
            }}
            returnKeyType="search"
            style={[
              styles.input,
              { borderColor: palette.border, backgroundColor: palette.surface, color: palette.ink },
            ]}
          />

          {/* Nobody until somebody is asked for. This offered the people you
              follow while the box was empty, which for anybody following more
              than a handful is a wall of names above the field — the thing
              this was meant to remove. The search finds them too. */}
          {!looksLikeEmail(email) && email.trim().length >= 2 && (
            <PeopleToInvite
              collaborators={people.collaborators}
              busy={busy}
              onInvite={inviteByUsername}
              query={email.trim()}
            />
          )}

          {/* And an address for somebody who is not here yet, which is the
              whole reason this is not only a people picker. */}
          {looksLikeEmail(email) && (
            <Pressable
              onPress={() => void inviteByEmail()}
              disabled={busy}
              style={[styles.send, { backgroundColor: palette.primary, alignItems: "center" }]}
            >
              <Text style={{ color: palette.onPrimary, fontWeight: "600", fontSize: 14 }}>
                Invite {email.trim()}
              </Text>
            </Pressable>
          )}
          {/* The rest of this sheet waits for Save; this does not. Inviting
              somebody sends them an email the moment it is tapped, and Cancel
              cannot call it back, so the field says so rather than letting
              anybody find out afterwards. */}
          <Text style={[type.meta, { color: palette.muted }]}>
            Search for anybody here, or type an address — they do not need an
            account yet. They can add stops, times and notes; they cannot
            publish, share or delete the trip. Invitations go out as soon as you
            tap Invite, not when you save.
          </Text>
        </>
      )}
    </>
  );
}

/// Compact rows rather than a FlatList: this lives inside the trip editor's
/// ScrollView, and nesting a virtualized list there is a fight we do not need.
function PeopleToInvite({
  collaborators,
  busy,
  onInvite,
  query,
}: {
  collaborators: Collaborator[];
  busy: boolean;
  onInvite: (username: string, label: string) => void;
  /// What was typed. Never empty — the parent draws nothing until there is
  /// something to look for.
  query: string;
}) {
  const palette = usePalette();
  const { data, loading } = useApi<{ people: Person[] }>(
    `/api/people?q=${encodeURIComponent(query)}`,
  );
  const taken = new Set(
    collaborators.map((c) => c.username).filter((u): u is string => Boolean(u)),
  );
  const candidates = (data?.people ?? []).filter(
    (p) => p.username && !taken.has(p.username),
  );

  if (loading && !data) {
    return (
      <Text style={[type.meta, { color: palette.muted, marginBottom: 8 }]}>
        Looking…
      </Text>
    );
  }

  if (!data?.people.length) {
    return (
      <Text style={[type.meta, { color: palette.muted, marginBottom: 8 }]}>
        Nobody by that name.
      </Text>
    );
  }

  if (candidates.length === 0) return null;

  return (
    <>
      <Text style={[styles.sublabel, { color: palette.muted }]}>Matches</Text>
      {candidates.map((person) => {
        const handle = person.username!;
        const label = person.name ?? `@${handle}`;
        return (
          <View
            key={person.id}
            style={[styles.row, { borderColor: palette.border, backgroundColor: palette.surface }]}
          >
            {person.image ? (
              <Image source={{ uri: person.image }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: palette.border }]}>
                <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "600" }}>
                  {label.replace("@", "").charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[type.item, { color: palette.ink }]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
                @{handle}
              </Text>
            </View>
            <Pressable
              onPress={() => onInvite(handle, label)}
              disabled={busy}
              hitSlop={8}
            >
              <Text style={{ color: palette.primary, fontSize: 13, fontWeight: "600" }}>
                Invite
              </Text>
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, marginTop: 18, marginBottom: 6, textTransform: "uppercase" },
  sublabel: { fontSize: 12, marginTop: 10, marginBottom: 6, textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: 12,
    marginBottom: 8,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  send: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
});
