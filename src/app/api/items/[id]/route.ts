import { NextResponse } from "next/server";
import { ownsCategory } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import { tripAccess } from "@/lib/trip-access";
import { firstIssue, itemUpdateSchema } from "@/lib/validation";
import type { CurrentUser } from "@/lib/user";
import {
  itemWithArrivalsInclude,
  serializeItineraryItem,
  uniqueUserIds,
  unknownArrivalUsers,
} from "@/lib/travel-arrivals";
import { acceptedTripUserIds, replaceArrivals } from "@/lib/trip-arrivals";

/// An item is editable by anyone who can edit its trip. The trip comes back
/// too, because some checks are about its owner rather than the caller.
async function loadEditable(id: string, user: CurrentUser) {
  const item = await prisma.itineraryItem.findUnique({ where: { id } });
  if (!item) return null;
  const access = await tripAccess(item.tripId, user);
  return access ? { item, access } : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const editable = await loadEditable(id, user);
  if (!editable) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { item: existing, access } = editable;

  const parsed = itemUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  // A category id arrives as a plain string, so it is checked against the
  // built-in ones and the trip owner's own before it is stored. The owner's,
  // not the caller's: a stop filed under an editor's private category would
  // render as nothing on the owner's screen.
  if (parsed.data.category && !(await ownsCategory(access.trip.userId, parsed.data.category))) {
    return NextResponse.json({ error: "No such category" }, { status: 400 });
  }
  const { arrivalUserIds, ...data } = parsed.data;
  const kind = data.kind ?? existing.kind;
  const arrivals =
    arrivalUserIds === undefined ? undefined : uniqueUserIds(arrivalUserIds);

  if (arrivals && arrivals.length > 0 && kind !== "travel") {
    return NextResponse.json(
      { error: "Who arrives is for a journey, not a stop" },
      { status: 400 },
    );
  }
  if (arrivals && arrivals.length > 0) {
    const allowed = await acceptedTripUserIds(existing.tripId, access.trip.userId);
    if (unknownArrivalUsers(arrivals, allowed).length > 0) {
      return NextResponse.json(
        { error: "Those people aren't on this trip" },
        { status: 400 },
      );
    }
  }

  // Everyone adds from their own library, so a place being attached must
  // belong to whoever is asking — the same check the create route makes.
  // Without it, any place id (and they are in every shared trip's payload)
  // could be attached here and read back whole, notes and all.
  for (const placeId of [data.placeId, data.toPlaceId]) {
    if (!placeId) continue;
    const place = await prisma.place.findUnique({ where: { id: placeId }, select: { userId: true } });
    if (!place || place.userId !== user.id) {
      return NextResponse.json({ error: "Unknown place" }, { status: 400 });
    }
  }

  // Moving an item to another day drops it at the end of that day unless the
  // caller said exactly where it should land.
  if (data.dayIndex !== undefined && data.dayIndex !== existing.dayIndex && data.position === undefined) {
    const last = await prisma.itineraryItem.findFirst({
      where: { tripId: existing.tripId, dayIndex: data.dayIndex },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    data.position = (last?.position ?? -1) + 1;
  }

  const item = await prisma.itineraryItem.update({
    where: { id },
    data,
    include: itemWithArrivalsInclude,
  });

  // A stop cannot keep a passenger list. Changing the kind, or sending a new
  // list (including an empty one), is what rewrites who lands.
  const nextArrivals = kind !== "travel" ? [] : arrivals;
  if (nextArrivals !== undefined) {
    await replaceArrivals(id, nextArrivals);
    item.arrivals = (
      await prisma.travelArrival.findMany({
        where: { itemId: id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, image: true, username: true } } },
      })
    );
  }

  return NextResponse.json({
    item: serializeItineraryItem(item, user.id),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  if (!(await loadEditable(id, user))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.itineraryItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
