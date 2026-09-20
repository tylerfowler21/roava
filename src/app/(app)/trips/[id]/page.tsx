import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/user";
import { tripAccess } from "@/lib/trip-access";
import { serializePlace, serializeTrip, type ItineraryItemDTO } from "@/lib/types";
import { itemWithArrivalsInclude, serializeItineraryItem } from "@/lib/travel-arrivals";
import TripPlanner from "@/components/TripPlanner";
import { ottoAround } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const access = await tripAccess(id, user);
  if (!access) notFound();

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id },
    include: {
      items: {
        orderBy: [{ dayIndex: "asc" }, { position: "asc" }],
        include: itemWithArrivalsInclude,
      },
      resources: { orderBy: { position: "asc" } },
      wants: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true, username: true, image: true } } },
      },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });

  // Editors see whose trip they are helping with.
  const ownerRecord = await prisma.user.findUnique({
    where: { id: trip.userId },
    select: { id: true, name: true, email: true, image: true },
  });
  const owner =
    access.role === "owner" ? "You" : (ownerRecord?.name ?? ownerRecord?.email ?? "Someone");

  // Loaded here rather than fetched on open, so the trip shows who is on it the
  // moment it renders instead of after a click.
  // Who has been invited but not yet arrived is the owner's business; an
  // editor sees the people who are actually on the trip.
  const collaborators = await prisma.tripCollaborator.findMany({
    where: { tripId: id, ...(access.role === "owner" ? {} : { acceptedAt: { not: null } }) },
    orderBy: { invitedAt: "asc" },
    include: { user: { select: { name: true, image: true, username: true } } },
  });

  const places = await prisma.place.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
  });

  const items: ItineraryItemDTO[] = trip.items.map((item) =>
    serializeItineraryItem(item, user.id),
  );

  return (
    <TripPlanner
      otto={ottoAround(user)}
      trip={serializeTrip(trip)}
      initialItems={items}
      places={places.map(serializePlace)}
      resources={trip.resources}
      wants={trip.wants.map((w) => ({
        id: w.id,
        label: w.label,
        userId: w.userId,
        user: w.user,
      }))}
      me={user.id}
      documents={trip.documents.map((d) => ({
        id: d.id,
        tripId: d.tripId,
        name: d.name,
        contentType: d.contentType,
        size: d.size,
        itemId: d.itemId,
        createdAt: d.createdAt.toISOString(),
      }))}
      role={access.role}
      ownerId={trip.userId}
      viewerId={user.id}
      ownerLabel={owner}
      ownerImage={ownerRecord?.image ?? null}
      people={collaborators.map((c) => ({
        email: c.email,
        role: c.role,
        accepted: c.acceptedAt !== null,
        userId: c.userId,
        name: c.user?.name ?? null,
        image: c.user?.image ?? null,
        username: c.user?.username ?? null,
      }))}
    />
  );
}
