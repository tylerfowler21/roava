"use client";

import { useRouter } from "next/navigation";
import DestinationField from "@/components/DestinationField";
import { pinFrom, pinsFor, type DestinationPin } from "@/lib/destination-pins";
import { TRIP_COLORS as COLORS } from "@/lib/brand";
import { regionLabel, regionOfColor } from "@/lib/regions";
import { tripRegions } from "@/lib/trip-where";
import { useState } from "react";
import { toDateInput } from "@/lib/trips";
import type { TripDTO } from "@/lib/types";

export default function TripSettings({
  trip,
  onUpdated,
}: {
  trip: TripDTO;
  onUpdated: (trip: TripDTO) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(trip.title);
  // Seeded from whichever field this trip has: one made before trips could go
  // to more than one place still has only the old one.
  const [destinations, setDestinations] = useState<string[]>(() => tripRegions(trip));
  /// Only ever holds the ones picked in this sitting. A destination the trip
  /// already had was resolved when it was added, and re-adding it changes
  /// nothing — the helper skips what is already on the map.
  const [pins, setPins] = useState<Record<string, DestinationPin>>({});
  const [startDate, setStartDate] = useState(toDateInput(trip.startDate));
  const [endDate, setEndDate] = useState(toDateInput(trip.endDate));
  const [color, setColor] = useState(trip.color);
  const [currency, setCurrency] = useState(trip.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting a whole itinerary deserves a second click, not a browser dialog.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [published, setPublished] = useState(trip.publishedAt !== null);

  /// Saved on its own rather than with the rest of the form, so switching
  /// visibility takes effect immediately and can't be left pending.
  async function publish(next: boolean) {
    setPublished(next);
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
      setPublished(!next);
      setError(body.error ?? "Could not change who can see this");
      return;
    }
    onUpdated(body.trip);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="self-start text-xs text-muted hover:underline"
        onClick={() => setOpen(true)}
      >
        Edit trip
      </button>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        destinations,
        destinationPins: pinsFor(destinations, pins),
        startDate: startDate || null,
        endDate: endDate || null,
        color,
        currency,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "Could not save the trip");
      return;
    }
    onUpdated(body.trip);
    setOpen(false);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });

    if (!res.ok) {
      setBusy(false);
      setError("Could not delete the trip");
      return;
    }
    router.push("/trips");
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-3">
      <input
        className="input"
        aria-label="Trip title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <DestinationField
        value={destinations}
        onPick={(label, result) =>
          setPins((current) => ({ ...current, [label]: pinFrom(label, result) }))
        }
        onChange={setDestinations}
        placeholder="Where does this trip go?"
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Starts
          <input
            type="date"
            className="input mt-1"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          Ends
          <input
            type="date"
            className="input mt-1"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Colour</span>
          {COLORS.map((c) => {
            const region = regionLabel(regionOfColor(c));
            return (
              <button
                key={c}
                type="button"
                title={region ?? c}
                aria-label={region ? `Use the ${region} colour` : `Use colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className="size-5 rounded-full"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}66` : undefined }}
              />
            );
          })}
          <span className="text-xs text-muted">{regionLabel(regionOfColor(color))}</span>
        </div>

        {/* What the colours mean, said once rather than left to be inferred.
            Every colour a trip can be given by where it goes is also one
            somebody can pick by hand, so a row of seven circles is really the
            seven regions — and nothing on screen said so. */}
        <label className="block text-xs text-muted">
          Currency
          <input
            className="input mt-1 w-28 uppercase"
            maxLength={3}
            placeholder="USD"
            aria-label="Currency for this trip"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        {/* One per trip, and why. Somebody pricing a week through the
            eurozone and Switzerland has to pick one and estimate the rest —
            which is what they were doing on paper, and better than a total
            nobody can compute without exchange rates. */}
        <p className="text-xs text-muted">
          Everything priced on this trip is in this currency. A trip through
          two of them means picking one and estimating the other.
        </p>

        <p className="text-xs text-muted">
          Trips are coloured by region — {regionLabel("europe")} blue, {regionLabel("asia")} red,
          and so on — so the list reads as a map. Picking one here overrides that.
        </p>
      </div>

      {/* Publishing is a different kind of decision from renaming, so it gets
          its own block rather than sitting among the text fields. */}
      <div className="space-y-1.5 border-t border-line pt-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={published}
            disabled={busy}
            onChange={(e) => publish(e.target.checked)}
          />
          <span>
            <span className="font-medium">Publish to my profile</span>
            <span className="mt-0.5 block text-xs text-muted">
              {published
                ? "Anyone can find this on your profile, and people who follow you see it in their feed. They can copy it, but not change yours."
                : "Private. Only you and anyone you've invited to edit can see it."}
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || title.trim().length === 0}
          onClick={save}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-ghost ml-auto text-red-500"
          disabled={busy}
          onClick={() => (confirmingDelete ? remove() : setConfirmingDelete(true))}
        >
          {confirmingDelete ? "Really delete?" : "Delete trip"}
        </button>
      </div>
    </div>
  );
}
