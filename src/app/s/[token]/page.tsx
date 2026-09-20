import type { Metadata } from "next";
import Link from "next/link";
import { resolvedCategories } from "@/lib/categories";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
import CopyTripButton from "@/components/CopyTripButton";
import SharedTrip from "@/components/SharedTrip";
import SignUpInvite from "@/components/SignUpInvite";
import { getCurrentUser } from "@/lib/user";
import { type PublicTripDTO } from "@/lib/types";
import { itemWithArrivalsInclude, toPublicItineraryItem } from "@/lib/travel-arrivals";

export const dynamic = "force-dynamic";

async function loadShared(token: string) {
  return prisma.tripShare.findUnique({
    where: { token },
    include: {
      trip: {
        include: {
          // Named on the sign-up invitation at the foot of the page.
          user: { select: { name: true, username: true } },
          items: {
            orderBy: [{ dayIndex: "asc" }, { position: "asc" }],
            include: itemWithArrivalsInclude,
          },
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await loadShared(token);

  return {
    title: share ? `${share.trip.title} — shared itinerary` : "Itinerary not found",
    // The link is the credential; it has no business in a search index.
    robots: { index: false, follow: false },
  };
}

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await loadShared(token);

  // A revoked link is deleted outright, so "not found" covers both a bad token
  // and one the owner has since turned off.
  if (!share) notFound();

  // A view is a person. Link previews and crawlers fetch the page too, and
  // counted them as friends opening it.
  const agent = (await headers()).get("user-agent") ?? "";
  if (!/bot|crawl|spider|preview|fetch|facebookexternalhit|slack|whatsapp|telegram|discord|twitter/i.test(agent)) {
    await prisma.tripShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
  }

  const trip: PublicTripDTO = {
    title: share.trip.title,
    destination: share.trip.destination,
    destinations: share.trip.destinations,
    startDate: share.trip.startDate?.toISOString() ?? null,
    endDate: share.trip.endDate?.toISOString() ?? null,
    color: share.trip.color,
    notes: share.trip.notes,
  };

  const items = share.trip.items.map(toPublicItineraryItem);

  const viewer = await getCurrentUser();
  const author = share.trip.user?.username
    ? `@${share.trip.user.username}`
    : (share.trip.user?.name ?? null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col">
        {/* This page is the one most likely to be somebody's first sight of
            Roava — it is what a friend sends. So it says whose it is at the
            top, and offers the way in without getting between them and the
            itinerary they came to read. */}
        <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-5 pt-6 lg:px-10">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/mark.png" alt="" width={30} height={30} className="rounded-lg" />
            <span className="display text-lg">Roava</span>
          </Link>
          {!viewer && (
            <a
              href={`/signin?next=${encodeURIComponent(`/s/${token}`)}`}
              className="btn btn-ghost"
            >
              Sign in
            </a>
          )}
        </header>

        <SharedTrip
          viewerSignedIn={viewer !== null}
          trip={trip}
          items={items}
          categories={await resolvedCategories(share.trip.userId)}
          author={author}
          actions={
            <>
              <CopyTripButton
                trip={trip}
                items={items}
                endpoint={`/api/s/${token}/copy`}
                signedIn={viewer !== null}
                isOwn={viewer?.id === share.trip.userId}
                returnTo={`/s/${token}`}
              />
              {viewer && (
                <Link href="/" className="btn btn-primary">
                  Open in Roava
                </Link>
              )}
              <p className="basis-full text-xs text-muted">
                Free. Every stop and note lands on your own map.
              </p>
            </>
          }
        />

        {/* A secret link is the one most likely to reach somebody with no
            account: it is what you send a friend. */}
        {!viewer && <SignUpInvite author={author} returnTo={`/s/${token}`} />}

        <footer className="mx-auto mt-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-8 text-xs text-muted lg:px-10">
          <span>
            Planned with <Link href="/" className="font-medium text-foreground">Roava</Link>
          </span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            {/* Somewhere to go when a shared link turns out to be something it
                should not be. The link is unlisted, so this page is the only
                place a reader could report it from. */}
            <a href={`mailto:hello@roava.co?subject=${encodeURIComponent(`Report a shared trip (${token})`)}`} className="hover:underline">
              Report this trip
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
