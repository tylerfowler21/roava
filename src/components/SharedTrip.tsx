"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { timingLabel } from "@/lib/duration";
import Image from "next/image";
import { tripWhere } from "@/lib/trip-where";
import DirectionsIcon from "@/components/DirectionsIcon";
import MapCanvas, { type MapPin } from "@/components/MapCanvas";
import { category as resolve, stopIcon, travelMode, type Category } from "@/lib/taxonomy";
import { dateForDay, dayCount, durationLabel, formatDay, formatRange } from "@/lib/trips";
import { directionsUrl } from "@/lib/directions";
import type { PublicItemDTO, PublicTripDTO } from "@/lib/types";
import { whoArrivesLabel } from "@/lib/travel-arrivals";

/// How many days show before "Show all" — enough to read the shape of a
/// trip, not so many that a fortnight is a wall.
const DAYS_BEFORE_FOLD = 3;

/// The read-only twin of TripPlanner, rendered for anyone holding a share
/// link. A hero, then the plan day by day beside one map of the whole trip.
/// Nothing here writes.
export default function SharedTrip({
  trip,
  items,
  categories = [],
  viewerSignedIn = false,
  author = null,
  actions = null,
}: {
  trip: PublicTripDTO;
  items: PublicItemDTO[];
  /// Whether whoever is reading this has an account. Decides the basemap: a
  /// stranger gets the free one so public traffic cannot exhaust the Apple
  /// quota, and somebody using the app gets the map the rest of it uses.
  viewerSignedIn?: boolean;
  /// The categories this trip's own stops use, sent with the page.
  ///
  /// Whoever is reading a shared itinerary is not signed in as the person who
  /// wrote it, and may not be signed in at all, so their own categories are no
  /// help. Without these, a stop filed under one somebody invented would
  /// quietly show as Other to everybody but its author.
  categories?: Category[];
  /// Who made it, as it should read: "@mara" or a name.
  author?: string | null;
  /// The buttons under the title — copy, save, report. The page decides.
  actions?: ReactNode;
}) {
  const categoryOf = useCallback((id: string) => resolve(id, categories), [categories]);
  const stopIconOf = useCallback(
    (item: Parameters<typeof stopIcon>[0]) => stopIcon(item, categories),
    [categories],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /// The day the map is fitted to; null is the whole trip.
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const days = dayCount(trip, items);
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.dayIndex - b.dayIndex || a.position - b.position),
    [items],
  );
  const byDay = useMemo(
    () => Array.from({ length: days }, (_, d) => sorted.filter((i) => i.dayIndex === d)),
    [sorted, days],
  );

  const stops = sorted.filter((i) => i.kind !== "travel");
  const cities = new Set(stops.map((i) => i.place?.city).filter(Boolean));

  const pins = useMemo<MapPin[]>(() => {
    const numberOf = new Map<string, number>();
    for (const day of byDay)
      day.filter((i) => i.kind !== "travel").forEach((item, i) => numberOf.set(item.id, i + 1));
    return sorted
      .filter((item) => item.place)
      .map((item) => ({
        id: item.id,
        lat: item.place!.lat,
        lng: item.place!.lng,
        color: activeDay === null || item.dayIndex === activeDay ? trip.color : categoryOf(item.category).color,
        icon: stopIconOf(item),
        badge: String(numberOf.get(item.id) ?? ""),
        muted: activeDay !== null && item.dayIndex !== activeDay,
      }));
  }, [sorted, byDay, trip.color, categoryOf, stopIconOf, activeDay]);

  const shown = useMemo(
    () => (activeDay === null ? sorted : (byDay[activeDay] ?? [])),
    [activeDay, sorted, byDay],
  );

  const legs = useMemo(
    () =>
      shown
        .filter((i) => i.kind === "travel" && i.place && i.toPlace)
        .map((i) => ({
          from: [i.place!.lng, i.place!.lat] as [number, number],
          to: [i.toPlace!.lng, i.toPlace!.lat] as [number, number],
        })),
    [shown],
  );

  const route = useMemo<[number, number][]>(
    () => shown.filter((i) => i.place).map((i) => [i.place!.lng, i.place!.lat] as [number, number]),
    [shown],
  );

  const visibleDays = showAll ? byDay : byDay.slice(0, DAYS_BEFORE_FOLD);
  const coverEmoji = stops[0] ? stopIconOf(stops[0]) : "🧭";

  /// The trip's cover: a photograph of somewhere it actually goes.
  ///
  /// Taken from the first stop that has one rather than from the first stop,
  /// because the first stop is often an airport or a hotel and the one after
  /// it is the reason for the trip. Wikipedia has pictures of landmarks and
  /// not of restaurants, which sorts them in roughly the right order by
  /// itself.
  const coverStop = useMemo(
    () => stops.find((i) => i.place?.photoUrl) ?? null,
    [stops],
  );
  const cover = coverStop?.place ?? null;
  /// Which day the photograph is from, so the caption can say so. It is the
  /// difference between a stock picture of the city and a picture of
  /// something on this trip.
  const coverDay = coverStop?.dayIndex ?? null;

  const facts = [
    formatRange(trip) !== "No dates yet" ? `📅 ${formatRange(trip)}` : null,
    `${days} ${days === 1 ? "day" : "days"}`,
    `${stops.length} ${stops.length === 1 ? "stop" : "stops"}`,
    cities.size > 0 ? `${cities.size} ${cities.size === 1 ? "city" : "cities"}` : null,
  ].filter((f): f is string => f !== null);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 py-8 lg:px-10 lg:py-12">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,560px)_1fr] lg:items-center">
        <div>
          {author && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-full bg-brand-surface text-xs font-semibold text-foreground"
              >
                {author.replace(/^@/, "").charAt(0).toUpperCase()}
              </span>
              <span>
                <span className="font-medium text-foreground">{author}</span> shared this trip
              </span>
            </p>
          )}
          <h1 className="mt-3 text-4xl leading-[1.05] lg:text-5xl">{trip.title}</h1>
          {(trip.notes || tripWhere(trip)) && (
            <p className="mt-3 max-w-prose text-base text-muted">
              {trip.notes || tripWhere(trip)}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {facts.map((f) => (
              <span key={f} className="chip cursor-default bg-surface text-[13px]">
                {f}
              </span>
            ))}
          </div>
          {actions && <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {/* A photograph of somewhere the trip goes. Failing that — a trip made
            entirely of restaurants, which Wikipedia has nothing for — the
            trip's own colour into evergreen, with the first stop's emoji. */}
        {cover?.photoUrl ? (
          <figure className="w-full">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[32px] lg:aspect-[640/460]">
              <Image
                src={cover.photoUrl}
                alt={cover.name}
                fill
                sizes="(min-width: 1024px) 640px, 100vw"
                className="object-cover"
              />
              {/* Which stop this is, on the photograph rather than under it.
                  A picture of somewhere on the trip is doing two jobs — making
                  the page worth looking at, and saying "this is a real place
                  you will go" — and only the second needs words. */}
              <figcaption className="glass-opaque absolute bottom-4 left-4 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium">
                <span aria-hidden>{coverStop ? stopIconOf(coverStop) : coverEmoji}</span>
                <span className="truncate">{cover.name}</span>
                {coverDay !== null && (
                  <span className="shrink-0 text-muted">· Day {coverDay + 1}</span>
                )}
              </figcaption>
            </div>
            {cover.photoAttribution && (
              <p className="mt-2 text-[11px] text-muted">
                Photo:{" "}
                {cover.photoSourceUrl ? (
                  <a
                    href={cover.photoSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {cover.photoAttribution}
                  </a>
                ) : (
                  cover.photoAttribution
                )}{" "}
                · via Wikipedia
              </p>
            )}
          </figure>
        ) : (
          <div
            className="flex aspect-[4/3] w-full items-end rounded-[32px] p-5 text-[color:var(--paint-card)] lg:aspect-[640/460]"
            style={{
              background: `linear-gradient(160deg, ${trip.color} 0%, var(--paint-evergreen-900) 80%)`,
            }}
          >
            <span aria-hidden className="text-7xl leading-none drop-shadow-lg">
              {coverEmoji}
            </span>
          </div>
        )}
      </section>

      {/* min-w-0 on both columns. A grid item's minimum width is its content
          by default, so the widest thing inside — a long stop name, the map —
          pushes the column past the page and the text runs off the right edge
          on a phone. */}
      <section className="mt-12 grid gap-6 lg:grid-cols-[1fr_520px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-2xl">The plan</h2>
            <p className="text-sm text-muted">Day by day, with times and notes</p>
          </div>

          <ol className="mt-4 space-y-4">
            {visibleDays.map((dayItems, d) => {
              const date = dateForDay(trip, d);
              const dayCities = [...new Set(dayItems.map((i) => i.place?.city).filter(Boolean))];
              const on = activeDay === d;
              let n = 0;
              return (
                <li key={d} className={`card p-5 ${on ? "ring-2 ring-accent" : ""}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-3 text-left"
                    aria-pressed={on}
                    title={on ? "Show the whole trip on the map" : "Show this day on the map"}
                    onClick={() => setActiveDay(on ? null : d)}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="display text-xl">Day {d + 1}</span>
                      {date && <span className="text-sm text-muted">{formatDay(date)}</span>}
                    </span>
                    {dayCities.length > 0 && (
                      <span className="chip cursor-default bg-background text-xs">
                        {dayCities.slice(0, 2).join(" · ")}
                      </span>
                    )}
                  </button>

                  {dayItems.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">Nothing planned for this day.</p>
                  ) : (
                    <ol className="mt-3 space-y-1">
                      {dayItems.map((item) => {
                        const leg = item.kind === "travel";
                        if (!leg) n += 1;
                        const meta = categoryOf(item.category);
                        const selected = selectedId === item.id;
                        return (
                          <li key={item.id}>
                            {leg ? (
                              <p className="flex items-center gap-2 py-1 pl-[3.25rem] text-xs text-muted">
                                <span aria-hidden>{travelMode(item.mode).icon}</span>
                                {[
                                  travelMode(item.mode).label,
                                  durationLabel(item),
                                  item.place && item.toPlace ? `${item.place.name} → ${item.toPlace.name}` : item.title,
                                  item.startTime ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}${item.endDayOffset > 0 ? ` +${item.endDayOffset}` : ""}` : null,
                                  whoArrivesLabel(item.arrivals),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : (
                              <div
                                className={`flex items-start gap-1 rounded-2xl transition-colors ${
                                  selected ? "bg-brand-surface" : "hover:bg-foreground/5"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedId(selected ? null : item.id)}
                                  aria-pressed={selected}
                                  className="flex min-w-0 flex-1 items-start gap-3 px-2 py-2 text-left"
                                >
                                  <span
                                    aria-hidden
                                    className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                                    style={{ background: trip.color }}
                                  >
                                    {n}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[15px] font-semibold">{item.title}</span>
                                    <span className="block truncate text-xs text-muted">
                                      {stopIconOf(item)} {meta.label}
                                      {item.place?.city ? ` · ${item.place.city}` : ""}
                                      {timingLabel(item) ? ` · ${timingLabel(item)}` : ""}
                                    </span>
                                    {item.notes && (
                                      <span className="mt-1 block text-sm text-muted">{item.notes}</span>
                                    )}
                                  </span>
                                  {/* The picture, where there is one and where
                                      there is room. A shared itinerary is read
                                      by somebody deciding whether they want the
                                      trip, and a photograph argues for a place
                                      better than its name does — but on a phone
                                      it takes the width the category and the
                                      duration need, and the boards leave it out
                                      there for exactly that reason. */}
                                  {item.place?.photoUrl && (
                                    <Image
                                      src={item.place.photoUrl}
                                      alt=""
                                      width={64}
                                      height={48}
                                      className="hidden h-12 w-16 shrink-0 rounded-[var(--radius-photo)] object-cover sm:block"
                                    />
                                  )}
                                </button>

                                {/* Beside the row rather than inside it. A
                                    link nested in a button is invalid, and the
                                    browsers that tolerate it do not all let a
                                    keyboard reach the inner one — so directions
                                    were mouse-only on a page whose whole job is
                                    to be read by somebody you sent it to. */}
                                {item.place && (
                                  <a
                                    href={directionsUrl({
                                      lat: item.place.lat,
                                      lng: item.place.lng,
                                      name: item.place.name,
                                    })}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Directions to ${item.place.name}`}
                                    title="Directions"
                                    className="mt-2 mr-2 shrink-0 rounded-full p-1 hover:bg-foreground/10"
                                  >
                                    <DirectionsIcon size={20} />
                                  </a>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>

          {!showAll && byDay.length > DAYS_BEFORE_FOLD && (
            <button
              type="button"
              className="btn btn-ghost mt-4 w-full justify-center"
              onClick={() => setShowAll(true)}
            >
              Show all {byDay.length} days ⌄
            </button>
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-6">
          <div className="card overflow-hidden">
            {/* A real height, not a minimum: the map fills its box by
                percentage and needs something definite to resolve against. */}
            <div className="h-[420px] lg:h-[640px]">
              <MapCanvas
                // A shared itinerary is readable with no account, so this map
                // is shown to strangers and crawlers, and public traffic on the
                // free basemap can never exhaust the Apple quota. Somebody
                // signed in gets the map the rest of the app uses.
                basemap={viewerSignedIn ? "auto" : "free"}
                pins={pins}
                route={route}
                legs={legs}
                routeColor={trip.color}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  // A pin on a day that is folded away has to be seen.
                  const hit = id ? items.find((i) => i.id === id) : null;
                  if (hit && hit.dayIndex >= DAYS_BEFORE_FOLD) setShowAll(true);
                }}
                fitToken={`shared-${activeDay ?? "all"}`}
              />
            </div>
            <p className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
              <span>{activeDay === null ? "Whole trip" : `Day ${activeDay + 1}`}</span>
              {activeDay !== null && (
                <button
                  type="button"
                  className="font-medium text-accent-text hover:underline"
                  onClick={() => setActiveDay(null)}
                >
                  Show the whole trip
                </button>
              )}
            </p>
          </div>
        </div>
      </section>

      <p className="mt-10 border-t border-line pt-4 text-xs text-muted">
        Shared with you from Roava · read-only
      </p>
    </div>
  );
}
