/// Copies the website's taxonomy over the app's, preserving the app copy's
/// header comment. The counterpart to check-mirror.
import { readFileSync, writeFileSync } from "node:fs";

const PAIRS = [
  ["src/lib/brand.ts", "mobile/src/lib/brand.ts"],
  ["src/lib/taxonomy.ts", "mobile/src/lib/taxonomy.ts"],
  ["src/lib/report-reasons.ts", "mobile/src/lib/report-reasons.ts"],
  ["src/lib/place-name.ts", "mobile/src/lib/place-name.ts"],
  ["src/lib/place-groups.ts", "mobile/src/lib/place-groups.ts"],
  ["src/lib/use-place-search.ts", "mobile/src/lib/use-place-search.ts"],
  ["src/lib/bookings.ts", "mobile/src/lib/bookings.ts"],
  ["src/lib/resources.ts", "mobile/src/lib/resources.ts"],
  ["src/lib/trip-calendar.ts", "mobile/src/lib/trip-calendar.ts"],
  ["src/lib/trip-where.ts", "mobile/src/lib/trip-where.ts"],
  ["src/lib/weather.ts", "mobile/src/lib/weather.ts"],
  ["src/lib/booking-deadline.ts", "mobile/src/lib/booking-deadline.ts"],
  ["src/lib/duration.ts", "mobile/src/lib/duration.ts"],
  ["src/lib/map-view.ts", "mobile/src/lib/map-view.ts"],
  ["src/lib/been.ts", "mobile/src/lib/been.ts"],
  ["src/lib/flag.ts", "mobile/src/lib/flag.ts"],
  ["src/lib/trip-styles.ts", "mobile/src/lib/trip-styles.ts"],
  ["src/lib/regions.ts", "mobile/src/lib/regions.ts"],
  ["src/lib/otto-says.ts", "mobile/src/lib/otto-says.ts"],
  ["src/lib/publish-prompt.ts", "mobile/src/lib/publish-prompt.ts"],
  ["src/lib/document-types.ts", "mobile/src/lib/document-types.ts"],
  ["src/lib/arrival-names.ts", "mobile/src/lib/arrival-names.ts"],
] as const;

for (const [source, mirror] of PAIRS) {
  const from = readFileSync(source, "utf8");
  const existing = readFileSync(mirror, "utf8");
  const bodyStart = from.search(/^(import|export) /m);
  const headerEnd = existing.search(/^(import|export) /m);
  if (headerEnd === -1) throw new Error(`${mirror} has no header to preserve`);
  writeFileSync(mirror, existing.slice(0, headerEnd) + from.slice(bodyStart));
  console.log(`Copied ${source} into ${mirror}`);
}
