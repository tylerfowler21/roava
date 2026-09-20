"use client";

import { useState } from "react";
import { formatMoney, parseMoney, toMajorString } from "@/lib/money";

/// What one thing on a trip costs.
///
/// Typed freely and normalised on the way out, because people write prices in
/// whatever way their hands know — "£12", "12.50", "1 234,56". The parser
/// takes symbols and separators off and the currency decides how many decimal
/// places that leaves.
///
/// Shown as a price when it is not being edited and as whatever was typed
/// while it is: reformatting under somebody's cursor is how a field loses a
/// digit they were halfway through.
export default function CostField({
  costMinor,
  currency,
  onSave,
}: {
  costMinor: number | null;
  currency: string;
  onSave: (costMinor: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  function commit() {
    setEditing(false);
    const trimmed = text.trim();
    // An emptied box means "unpriced", which is not the same as free — so it
    // saves null rather than zero.
    const next = trimmed === "" ? null : parseMoney(trimmed, currency);
    if (next !== costMinor) onSave(next);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(costMinor === null ? "" : toMajorString(costMinor, currency));
          setEditing(true);
        }}
        className="rounded-full border border-line px-2 py-1 text-xs text-muted hover:bg-foreground/5"
        aria-label={costMinor === null ? "Add a cost" : "Change the cost"}
      >
        {costMinor === null ? "Cost?" : formatMoney(costMinor, currency)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="What this costs"
      className="w-20 rounded-full border border-line bg-surface px-2 py-1 text-xs"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
