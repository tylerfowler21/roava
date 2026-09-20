import { NextResponse } from "next/server";
import { ownsCategory } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import { tripAccess } from "@/lib/trip-access";
import { firstIssue, itemCreateSchema } from "@/lib/validation";
import {
  itemWithArrivalsInclude,
  serializeItineraryItem,
  uniqueUserIds,
  unknownArrivalUsers,
} from "@/lib/travel-arrivals";
import { acceptedTripUserIds } from "@/lib/trip-arrivals";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: tripId } = await params;

  // Editors may add stops; that is the whole point of inviting them.
  const access = await tripAccess(tripId, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = itemCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  // A category id arrives as a plain string, so it is checked against the
  // built-in ones and the trip owner's own before it is stored — the owner's,
  // because a stop under an editor's private category renders as nothing on
  // the owner's screen.
  if (parsed.data.category && !(await ownsCategory(access.trip.userId, parsed.data.category))) {
    return NextResponse.json({ error: "No such category" }, { status: 400 });
  }
  const { arrivalUserIds, ...data } = parsed.data;
  const arrivals = uniqueUserIds(arrivalUserIds ?? []);

  if (arrivals.length > 0 && data.kind !== "travel") {
    return NextResponse.json(
      { error: "Who arrives is for a journey, not a stop" },
      { status: 400 },
    );
  }
  if (arrivals.length > 0) {
    const allowed = await acceptedTripUserIds(tripId, access.trip.userId);
    if (unknownArrivalUsers(arrivals, allowed).length > 0) {
      return NextResponse.json(
        { error: "Those people aren't on this trip" },
        { status: 400 },
      );
    }
  }

  // Everyone adds from their own library, so the places must belong to whoever
  // is asking — not to the trip's owner. A travel leg has two of them.
  for (const id of [data.placeId, data.toPlaceId]) {
    if (!id) continue;
    const place = await prisma.place.findUnique({ where: { id } });
    if (!place || place.userId !== user.id) {
      return NextResponse.json({ error: "Unknown place" }, { status: 400 });
    }
  }

  const last = await prisma.itineraryItem.findFirst({
    where: { tripId, dayIndex: data.dayIndex },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const item = await prisma.itineraryItem.create({
    data: {
      ...data,
      tripId,
      position: (last?.position ?? -1) + 1,
      arrivals: arrivals.length ? { create: arrivals.map((userId) => ({ userId })) } : undefined,
    },
    include: itemWithArrivalsInclude,
  });

  return NextResponse.json(
    { item: serializeItineraryItem(item, user.id) },
    { status: 201 },
  );
}
