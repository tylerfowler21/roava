/// Fails if the app's copy of the taxonomy has drifted from the website's.
///
/// Categories decide the emoji and the colour of every pin. If the two copies
/// disagree, the same saved place looks like two different places depending on
/// which screen you are looking at — a bug that is invisible in either codebase
/// on its own, which is exactly why it is worth a check.
import { readFileSync } from "node:fs";

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

/// The mirror carries an explanatory header the original does not. Everything
/// from the first import or export onwards has to match exactly.
function body(text: string) {
  const start = text.search(/^(import|export) /m);
  return start === -1 ? text : text.slice(start);
}

let drifted = false;
for (const [source, mirror] of PAIRS) {
  if (body(readFileSync(source, "utf8")) !== body(readFileSync(mirror, "utf8"))) {
    console.error(`${mirror} has drifted from ${source}.`);
    drifted = true;
  } else {
    console.log(`${mirror} matches ${source}`);
  }
}
if (drifted) {
  console.error("\nCopy the website's versions over the app's:\n    npm run sync:mirror\n");
  process.exit(1);
}
