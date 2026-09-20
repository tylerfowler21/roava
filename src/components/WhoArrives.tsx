"use client";

import AvatarImage from "@/components/AvatarImage";

export type PartyPerson = {
  userId: string;
  name: string;
  image: string | null;
};

/// Who is landing on this travel leg.
///
/// Hidden on a solo trip — tagging yourself arriving on your own flight is
/// noise. Shown once there is more than one person on the trip, and still
/// shown (read-only) if someone already tagged is the only person left.
export default function WhoArrives({
  people,
  selectedIds,
  onChange,
  disabled = false,
}: {
  people: PartyPerson[];
  selectedIds: string[];
  onChange?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const canEdit = Boolean(onChange) && people.length >= 2 && !disabled;
  if (people.length < 2 && selectedIds.length === 0) return null;

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-muted">Who&apos;s arriving</legend>
      {canEdit ? (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {people.map((person) => {
              const on = selectedIds.includes(person.userId);
              const initial = person.name.charAt(0).toUpperCase();
              return (
                <button
                  key={person.userId}
                  type="button"
                  className={`chip ${on ? "is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    const next = on
                      ? selectedIds.filter((id) => id !== person.userId)
                      : [...selectedIds, person.userId];
                    onChange!(next);
                  }}
                >
                  <AvatarImage
                    src={person.image}
                    title={person.name}
                    size={16}
                    className="-ml-0.5 size-4 rounded-full object-cover"
                    fallback={
                      <span
                        aria-hidden
                        className="grid size-4 place-items-center rounded-full bg-foreground/10 text-[9px] font-semibold"
                      >
                        {initial}
                      </span>
                    }
                  />
                  {person.name}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">
            Optional — leave empty if it&apos;s everyone, or if it doesn&apos;t matter.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm">
          {people
            .filter((p) => selectedIds.includes(p.userId))
            .map((p) => p.name)
            .join(", ") || "Not tagged"}
        </p>
      )}
    </fieldset>
  );
}
