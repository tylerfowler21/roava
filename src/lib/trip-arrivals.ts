import { prisma } from "@/lib/prisma";
import { uniqueUserIds } from "@/lib/travel-arrivals";

/// Owner plus anyone who has actually joined. Pending invitations are not a
/// person on a flight yet — they cannot open the trip.
export async function acceptedTripUserIds(tripId: string, ownerId: string): Promise<Set<string>> {
  const collaborators = await prisma.tripCollaborator.findMany({
    where: { tripId, acceptedAt: { not: null }, userId: { not: null } },
    select: { userId: true },
  });
  return new Set(
    [ownerId, ...collaborators.map((c) => c.userId).filter((id): id is string => Boolean(id))],
  );
}

export async function replaceArrivals(itemId: string, userIds: string[]) {
  const ids = uniqueUserIds(userIds);
  await prisma.travelArrival.deleteMany({ where: { itemId } });
  if (ids.length === 0) return;
  await prisma.travelArrival.createMany({
    data: ids.map((userId) => ({ itemId, userId })),
  });
}
