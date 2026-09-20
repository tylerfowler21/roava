import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { unauthorized } from "@/lib/api";
import { tripAccess } from "@/lib/trip-access";
import { firstIssue, wantCreateSchema } from "@/lib/validation";

/// What the people on a trip say they want out of it.
///
/// Anybody with access may add one, including an editor — that is the whole
/// point. The itinerary is the organiser's to build; this is everyone else's
/// way of being heard without twenty people editing the same day.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = wantCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  const want = await prisma.tripWant.create({
    data: { tripId: id, userId: user.id, label: parsed.data.label },
    select: {
      id: true,
      label: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true, username: true, image: true } },
    },
  });

  return NextResponse.json({ want });
}
