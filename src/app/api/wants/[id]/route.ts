import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { unauthorized } from "@/lib/api";
import { tripAccess } from "@/lib/trip-access";

/// Taking one back.
///
/// Yours to remove, or the owner's. An editor cannot delete somebody else's —
/// a list where anybody can quietly drop what anybody else asked for is worse
/// than no list, because it looks like everyone was heard.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const want = await prisma.tripWant.findUnique({
    where: { id },
    select: { id: true, userId: true, tripId: true },
  });
  if (!want) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await tripAccess(want.tripId, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mine = want.userId === user.id;
  if (!mine && access.role !== "owner") {
    return NextResponse.json({ error: "That isn't yours to remove" }, { status: 403 });
  }

  await prisma.tripWant.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
