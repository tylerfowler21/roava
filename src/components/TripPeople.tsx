"use client";

import { useEffect, useState } from "react";
import type { TripRole } from "@/lib/trip-access";
import AvatarImage from "@/components/AvatarImage";

export type Collaborator = {
  email: string;
  role: string;
  accepted: boolean;
  /// Null until they have an account bound to the invitation. Tagging who
  /// arrives on a flight needs this; pending invites cannot be tagged.
  userId: string | null;
  name: string | null;
  image: string | null;
  username: string | null;
};

type FollowedPerson = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
};

/// A small stack of who is on a trip. Initials rather than a text link,
/// because "who else can edit this" is a thing you should be able to see
/// rather than a thing you have to go looking for.
function Avatar({ person, title }: { person: Collaborator; title: string }) {
  const initial = (person.name ?? person.email).charAt(0).toUpperCase();
  return (
    <AvatarImage
      src={person.image}
      title={title}
      size={24}
      className="size-6 rounded-full object-cover ring-2 ring-surface"
      fallback={
        <span
          title={title}
          className={`grid size-6 place-items-center rounded-full text-[10px] font-semibold ring-2 ring-surface ${
            person.accepted ? "bg-accent/15 text-accent-text" : "bg-foreground/10 text-muted"
          }`}
        >
          {initial}
        </span>
      }
    />
  );
}

function personLabel(person: { name: string | null; username: string | null; email?: string }) {
  return person.name ?? (person.username ? `@${person.username}` : (person.email ?? "them"));
}

/// Enough of an address to be worth offering to send to. The server checks it
/// properly; this only decides which half of the field is showing.
function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function TripPeople({
  tripId,
  role,
  ownerLabel,
  ownerImage,
  initialPeople,
}: {
  tripId: string;
  role: TripRole;
  ownerLabel: string;
  ownerImage: string | null;
  initialPeople: Collaborator[];
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Collaborator[] | null>(initialPeople);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /// Said out loud when an invitation is recorded but the email did not go.
  /// The person still has access — silence here would let the owner assume
  /// something landed in an inbox when nothing did.
  const [notice, setNotice] = useState<string | null>(null);
  /// Anybody the search turned up, kept with the query they answered so a
  /// result from two keystrokes ago is never shown against a word nobody
  /// typed. Derived rather than cleared: emptying it in an effect is a render
  /// that causes another render.
  const [found, setFound] = useState<{ q: string; people: FollowedPerson[] }>({
    q: "",
    people: [],
  });

  useEffect(() => {
    if (!open || people !== null) return;
    let cancelled = false;

    fetch(`/api/trips/${tripId}/collaborators`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setPeople(body.collaborators ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load who's on this trip");
      });

    return () => {
      cancelled = true;
    };
  }, [open, people, tripId]);

  /// Looked up as they type, unless what they are typing is plainly an
  /// address — nobody searching for "friend@example.com" wants a list of
  /// people whose names contain an @.
  useEffect(() => {
    const q = email.trim();
    if (!open || role !== "owner" || q.length < 2 || looksLikeEmail(q)) return;
    // A pause, so a five-letter name is one request rather than four.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
          if (!res.ok) return;
          const body = (await res.json()) as { people: FollowedPerson[] };
          setFound({ q, people: body.people.slice(0, 6) });
        } catch {
          // A search that failed is a search with nothing in it. The address
          // route is still open and the line underneath says so.
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [email, open, role]);

  async function invite(payload: { email: string } | { username: string }) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch(`/api/trips/${tripId}/collaborators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not invite that person");
      return;
    }
    setPeople((prev) => [
      ...(prev ?? []).filter((p) => p.email !== body.collaborator.email),
      body.collaborator,
    ]);
    const byHandle = "username" in payload;
    const who = byHandle
      ? personLabel(body.collaborator)
      : body.collaborator.email;
    setNotice(
      body.emailed
        ? `Invitation sent to ${who}.`
        : `${who} has access, but the email didn't send — tell them yourself and send them this trip's link.`,
    );
    if ("email" in payload) setEmail("");
  }

  async function remove(target: string) {
    setBusy(true);
    const res = await fetch(
      `/api/trips/${tripId}/collaborators?email=${encodeURIComponent(target)}`,
      { method: "DELETE" },
    );
    setBusy(false);

    if (!res.ok) {
      setError("Could not remove that person");
      return;
    }
    setPeople((prev) => (prev ?? []).filter((p) => p.email !== target));
  }

  if (!open) {
    const shown = (people ?? []).slice(0, 4);
    const extra = (people ?? []).length - shown.length;

    return (
      <button
        type="button"
        className="-m-1 flex items-center gap-2 self-start rounded-md p-1 hover:bg-foreground/5"
        onClick={() => setOpen(true)}
        title={
          role === "owner"
            ? "Who can edit this trip"
            : `${ownerLabel} shared this trip with you`
        }
      >
        <span className="flex -space-x-1.5">
          <Avatar
            person={{
              email: ownerLabel,
              role: "owner",
              accepted: true,
              userId: null,
              name: ownerLabel,
              image: ownerImage,
              username: null,
            }}
            title={`${ownerLabel} — owner`}
          />
          {shown.map((p) => (
            <Avatar
              key={p.email}
              person={p}
              title={`${p.name ?? p.email}${p.accepted ? "" : " — invited"}`}
            />
          ))}
          {extra > 0 && (
            <span className="grid size-6 place-items-center rounded-full bg-foreground/10 text-[10px] font-semibold text-muted ring-2 ring-surface">
              +{extra}
            </span>
          )}
        </span>

        <span className="text-xs text-accent-text">
          {role !== "owner"
            ? "Shared with you"
            : (people ?? []).length === 0
              ? "+ Invite someone"
              : "Manage"}
        </span>
      </button>
    );
  }

  const taken = new Set(
    (people ?? []).map((p) => p.username).filter((u): u is string => Boolean(u)),
  );
  const typed = email.trim();
  const searching = typed.length >= 2 && !looksLikeEmail(typed);
  /// Nobody until somebody is asked for.
  ///
  /// This offered the people you follow while the box was empty, on the
  /// grounds that a list you assembled yourself is not browsing. That is true
  /// and beside the point: somebody following seventeen people gets seventeen
  /// rows above the field, which is the wall this was meant to remove. The
  /// field is the interface; the search finds the people you follow too.
  const candidates = (searching && found.q === typed ? found.people : []).filter(
    (p) => p.username && !taken.has(p.username),
  );

  return (
    <div className="card space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Who&apos;s on this trip</h2>
          <p className="mt-0.5 text-xs text-muted">
            {role === "owner"
              ? "Anyone here can add, reorder and remove stops. Only you can rename the trip, share it or delete it."
              : `${ownerLabel} shared this with you. You can change the itinerary; the trip itself is theirs.`}
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

      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 text-sm">
          <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-text">
            {ownerLabel.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate">{ownerLabel}</span>
          <span className="text-xs text-muted">owner</span>
        </li>

        {(people ?? []).map((person) => (
          <li key={person.email} className="flex items-center gap-2 text-sm">
            <span className="grid size-6 place-items-center rounded-full bg-foreground/10 text-xs font-semibold">
              {(person.name ?? person.email).charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {person.name ?? person.email}
            </span>
            {!person.accepted && (
              <span className="text-xs text-muted">invited</span>
            )}
            {role === "owner" && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-foreground/5"
                disabled={busy}
                onClick={() => remove(person.email)}
              >
                Remove
              </button>
            )}
          </li>
        ))}

        {people?.length === 0 && (
          <li className="text-xs text-muted">Nobody else yet.</li>
        )}
      </ul>

      {role === "owner" && (
        <>
          <input
            className="input w-full"
            type="text"
            id={`invite-${tripId}`}
            placeholder="Name, username, or email address"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {searching && candidates.length === 0 && found.q === typed ? (
            <p className="text-xs text-muted">Nobody by that name.</p>
          ) : candidates.length > 0 ? (
            <div className="space-y-1.5">
              <ul className="space-y-1">
                {candidates.map((person) => {
                  const handle = person.username!;
                  const initial = (person.name ?? handle).charAt(0).toUpperCase();
                  return (
                    <li key={person.id} className="flex items-center gap-2 text-sm">
                      <AvatarImage
                        src={person.image}
                        size={24}
                        className="size-6 rounded-full object-cover"
                        fallback={
                          <span className="grid size-6 place-items-center rounded-full bg-foreground/10 text-xs font-semibold">
                            {initial}
                          </span>
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {person.name ?? `@${handle}`}
                        {person.name && (
                          <span className="text-xs text-muted"> @{handle}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-xs text-accent-text hover:bg-foreground/5"
                        disabled={busy}
                        onClick={() => invite({ username: handle })}
                      >
                        Invite
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* An address for somebody who is not here yet, which is the whole
              reason this is not only a people picker. */}
          {looksLikeEmail(typed) && (
            <button
              type="button"
              className="btn btn-primary w-full justify-center"
              disabled={busy}
              onClick={() => invite({ email: typed })}
            >
              Invite {typed}
            </button>
          )}
          {/* What actually happens, which is not what this said. Roava has
              emailed invitations since the collaborator work landed — the line
              below it says "Invitation sent to …" — and this paragraph was
              still telling people to go and pass it on themselves. */}
          <p className="text-xs text-muted">
            Search for anybody here, or type an address — they don&apos;t need
            an account yet, and it works the moment they sign in with it.
          </p>
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      {notice && <p className="text-xs text-muted">{notice}</p>}
    </div>
  );
}
