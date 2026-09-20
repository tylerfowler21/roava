/// Money on a trip.
///
/// Stored as a whole number of the currency's smallest unit — cents, pence,
/// yen — and never as a decimal. A price is a count of indivisible things, and
/// the moment it becomes a float it starts producing totals ending in
/// .999999994 that nobody can explain and everybody notices.
///
/// "Smallest unit" is not always a hundredth. Yen has no subunit at all and
/// dinars have three, so the exponent has to come from the currency rather
/// than be assumed — ¥1000 stored as 100000 would show as ¥100,000, which is
/// the kind of bug that gets found in Tokyo.

/// How many decimal places a currency actually has. Asked of Intl rather than
/// kept in a table here: the table would be wrong for something eventually,
/// and this is the same data the formatter is about to use anyway.
export function minorUnits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    // An unknown currency code. Two is right for most of the world and wrong
    // quietly rather than loudly.
    return 2;
  }
}

/// A whole number of minor units, as somebody would read it.
export function formatMoney(minor: number, currency: string): string {
  const places = minorUnits(currency);
  const major = minor / 10 ** places;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      // Whole amounts read better without the trailing zeroes on a list of
      // twenty of them; anything with a fraction keeps it.
      minimumFractionDigits: Number.isInteger(major) ? 0 : places,
      maximumFractionDigits: places,
    }).format(major);
  } catch {
    return `${major}`;
  }
}

/// What somebody typed, as minor units, or null if it was not a number.
///
/// Deliberately forgiving about what a person types into a box next to a
/// price: currency symbols, thousands separators and stray spaces all come
/// out. A comma is treated as a decimal point when it is clearly one —
/// "12,50" is twelve fifty in most of Europe — and as a separator otherwise.
export function parseMoney(text: string, currency: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised: string;
  if (lastComma > lastDot) {
    // "1.234,56" — dots group, comma decides.
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // "1,234.56" or "1234.56" — commas group.
    normalised = cleaned.replace(/,/g, "");
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  // Rounded rather than truncated: somebody typing 10.005 into a two-place
  // currency means a penny more, not a penny less.
  return Math.round(value * 10 ** minorUnits(currency));
}

/// The number to put in a box somebody is about to edit — plain digits, no
/// symbol, no grouping. Not `formatMoney`: a field showing "$1,234.00" is a
/// field where selecting all and typing produces nonsense, and where the
/// comma has to be parsed back out of the thing we just wrote.
export function toMajorString(minor: number, currency: string): string {
  const places = minorUnits(currency);
  const major = minor / 10 ** places;
  return Number.isInteger(major) ? String(major) : major.toFixed(places);
}

/// What a set of things costs. Anything without a price is not counted, and
/// is not the same as something that costs nothing.
export function totalOf(items: { costMinor: number | null }[]): number {
  return items.reduce((sum, item) => sum + (item.costMinor ?? 0), 0);
}

/// Whether it is worth showing a total at all. A trip where nobody has priced
/// anything should not be carrying zeroes around.
export function anyPriced(items: { costMinor: number | null }[]): boolean {
  return items.some((item) => item.costMinor !== null);
}
