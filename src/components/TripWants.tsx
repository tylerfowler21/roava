"use client";

import { useState } from "react";
import type { TripWantDTO } from "@/lib/types";

/// What everyone on a trip says they want out of it.
///
/// A trip with five families on it has one organiser and nineteen other
/// opinions, and the itinerary is the wrong place for them: it is editable by
/// everybody, which sounds like collaboration and works like a scrum. This is
/// the quiet half — say what you would like, see what everyone else said, and
/// let whoever is building the days read the lot.
///
/// Attributed, always. An unattributed wish list is a suggestion box; what an
/// organiser needs to see is who has not been listened to yet.
///
/// Yours to remove, or the owner's. An editor cannot quietly drop what
/// somebody else asked for — a list where that is possible is worse than no
/// list, because it still looks like everyone was heard.
export default function TripWants({
  tripId,
  initial,
  me,
  isOwner,
}: {
  tripId: string;
  initial: TripWantDTO[];
  /// The current user's id, to know which rows are theirs.
  me: string;
  isOwner: boolean;
}) {
  const [wants, setWants] = useState(initial);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = wants.filter((w) => w.userId === me).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const what = label.trim();
    if (!what) return;
    setBusy(true);
    setError(null);
    setLabel("");
    try {
      const res = await fetch(`/api/trips/${tripId}/wants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: what }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add that");
      setWants((prev) => [...prev, body.want]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that");
      setLabel(what);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const gone = wants.find((w) => w.id === id);
    setWants((prev) => prev.filter((w) => w.id !== id));
    try {
      const res = await fetch(`/api/wants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      if (gone) setWants((prev) => [...prev, gone]);
      setError("That didn't save");
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold">
        What everyone wants
        {wants.length > 0 && (
          <span className="ml-2 text-xs font-normal text-muted">
            {wants.length} {wants.length === 1 ? "idea" : "ideas"}
          </span>
        )}
      </h2>

      {wants.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Everyone on this trip can add what they&apos;d like to do — a museum,
          one proper dinner, a morning with nothing in it. Whoever builds the
          days gets to see the lot.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {wants.map((want) => {
            const who =
              want.user.name ?? (want.user.username ? `@${want.user.username}` : "Someone");
            const yours = want.userId === me;
            return (
              <li
                key={want.id}
                className="group flex items-start gap-2 rounded-lg border border-line p-2"
              >
                <span className="min-w-0 flex-1 text-sm">
                  {want.label}
                  <span className="block text-xs text-muted">{yours ? "You" : who}</span>
                </span>
                {(yours || isOwner) && (
                  <button
                    type="button"
                    onClick={() => void remove(want.id)}
                    aria-label={`Remove ${want.label}`}
                    className="shrink-0 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <form onSubmit={add} className="mt-2">
        <input
          className="input text-sm"
          placeholder={
            mine === 0 ? "What would make this trip worth it for you?" : "Anything else?"
          }
          aria-label="Something you want to do"
          maxLength={120}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />
      </form>
    </div>
  );
}
