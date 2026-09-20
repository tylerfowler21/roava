import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/user";
import { tripAccess } from "@/lib/trip-access";
import { collaboratorInviteSchema, firstIssue } from "@/lib/validation";
import { invitationEmail, sendMail } from "@/lib/mail";
import { isBlockedBetween } from "@/lib/moderation";

const collaboratorUser = { select: { name: true, image: true, username: true } };

function serialize(c: {
  email: string;
  role: string;
  userId: string | null;
  acceptedAt: Date | null;
  user: { name: string | null; image: string | null; username: string | null } | null;
}) {
  return {
    email: c.email,
    role: c.role,
    accepted: c.acceptedAt !== null,
    // Needed to tag who arrives on a travel leg. Null until the invitation
    // is bound to an account.
    userId: c.userId,
    name: c.user?.name ?? null,
    image: c.user?.image ?? null,
    // Public handle, for matching people you follow without seeing their email.
    username: c.user?.username ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Who has been invited but not yet arrived is the owner's business; an
  // editor sees the people who are actually on the trip, not a list of
  // email addresses that never answered.
  const collaborators = await prisma.tripCollaborator.findMany({
    where: { tripId: id, ...(access.role === "owner" ? {} : { acceptedAt: { not: null } }) },
    orderBy: { invitedAt: "asc" },
    include: { user: collaboratorUser },
  });

  // Who owns it, for a client that has no page around it to say so. An editor
  // has no other way to learn whose trip they were invited to, and a list of
  // who can edit that leaves out the one person who certainly can is a strange
  // list. Name and picture only — the owner's address is not the caller's.
  const owner = await prisma.user.findUnique({
    where: { id: access.trip.userId },
    select: { id: true, name: true, username: true, image: true },
  });

  return NextResponse.json({
    role: access.role,
    owner,
    collaborators: collaborators.map(serialize),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Only the owner decides who else gets in.
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Only the trip owner can invite people" }, { status: 403 });
  }

  const parsed = collaboratorInviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }

  let email: string;
  let existingUser: { id: string } | null = null;

  if (parsed.data.username || parsed.data.userId) {
    // Invite by handle (or id) so the client never has to know their email.
    const target = parsed.data.username
      ? await prisma.user.findUnique({
          where: { username: parsed.data.username },
          select: { id: true, email: true },
        })
      : await prisma.user.findUnique({
          where: { id: parsed.data.userId! },
          select: { id: true, email: true },
        });

    if (!target) return NextResponse.json({ error: "No such person" }, { status: 404 });
    if (target.id === user.id) {
      return NextResponse.json({ error: "That's you — you already own this trip" }, { status: 400 });
    }
    if (await isBlockedBetween(user.id, target.id)) {
      return NextResponse.json({ error: "No such person" }, { status: 404 });
    }
    if (!target.email) {
      return NextResponse.json(
        { error: "They don't have an email on file, so we can't invite them this way" },
        { status: 400 },
      );
    }

    email = target.email.toLowerCase();
    existingUser = { id: target.id };
  } else {
    email = parsed.data.email!;

    if (email === user.email?.toLowerCase()) {
      return NextResponse.json({ error: "That's you — you already own this trip" }, { status: 400 });
    }

    // Invitations are addressed to an email, so someone who has not signed up
    // yet can still be invited; it binds to their account when they first open
    // the trip.
    existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser && (await isBlockedBetween(user.id, existingUser.id))) {
      return NextResponse.json({ error: "No such person" }, { status: 404 });
    }
  }

  const collaborator = await prisma.tripCollaborator.upsert({
    where: { tripId_email: { tripId: id, email } },
    update: {},
    create: {
      tripId: id,
      email,
      userId: existingUser?.id ?? null,
      acceptedAt: existingUser ? new Date() : null,
    },
    include: { user: collaboratorUser },
  });

  // Told about it, if we can. Deliberately after the row exists and never
  // able to undo it: the collaborator record is what grants access, and the
  // email only says so. A provider having a bad afternoon should not cost
  // somebody their invitation.
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { title: true },
  });

  const origin = new URL(request.url).origin;
  const { subject, text, html } = invitationEmail({
    inviterName: user.name ?? user.email ?? "Someone",
    tripTitle: trip?.title ?? "a trip",
    url: `${origin}/trips/${id}`,
  });

  const delivery = await sendMail({ to: email, subject, text, html });

  return NextResponse.json(
    {
      collaborator: serialize(collaborator),
      // Reported so the interface can say "invited, but the email did not go"
      // rather than implying something arrived that did not.
      emailed: delivery.sent,
      emailError: delivery.sent ? null : delivery.reason,
    },
    { status: 201 },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const access = await tripAccess(id, user);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Which person?" }, { status: 400 });

  // The owner can remove anyone; an editor may only remove themselves.
  const removingSelf = email === user.email?.toLowerCase();
  if (access.role !== "owner" && !removingSelf) {
    return NextResponse.json({ error: "Only the trip owner can remove people" }, { status: 403 });
  }

  const existing = await prisma.tripCollaborator.findFirst({
    where: { tripId: id, email },
    select: { userId: true },
  });
  await prisma.tripCollaborator.deleteMany({ where: { tripId: id, email } });
  // A person taken off the trip should not keep landing on its flights.
  if (existing?.userId) {
    await prisma.travelArrival.deleteMany({
      where: { userId: existing.userId, item: { tripId: id } },
    });
  }
  return NextResponse.json({ ok: true });
}
