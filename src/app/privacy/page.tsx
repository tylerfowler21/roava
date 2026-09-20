import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy — Roava" };

const CONTACT = process.env.ADMIN_EMAILS?.split(",")[0]?.trim() ?? "";

/// Deliberately outside the (app) group: a privacy policy has to be readable
/// without an account, and App Store review will fetch it signed out.
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-10 text-sm">
      <div>
        <Link href="/" className="text-xs text-accent-text hover:underline">
          ← Roava
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Privacy</h1>
        <p className="mt-1 text-muted">
          Roava is a small personal project, not a company. This describes what
          it stores and who can see it, in plain terms.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">What it stores</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            Your name, email address and profile picture, from Google when you
            sign in. Roava never sees your Google password.
          </li>
          <li>
            The places you save, the trips you build, and any journal entries
            and photos you write or upload.
          </li>
          <li>Who you follow, and who follows you.</li>
          <li>Reports you send, so they can be reviewed.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Who can see it</h2>
        <p className="text-muted">
          Everything is private by default. Nothing you save is visible to
          anyone else unless you choose to publish it.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <span className="text-foreground">Publishing a trip</span> puts it on
            your public profile and in your followers&apos; feeds. It shows the
            itinerary and its stops — never your private notes or ratings on the
            underlying places, and never your email.
          </li>
          <li>
            <span className="text-foreground">A share link</span> makes one trip
            readable by anyone holding the link. Replacing the link breaks the
            old one immediately.
          </li>
          <li>
            <span className="text-foreground">
              Showing where you have been to your followers
            </span>{" "}
            is a setting, off until you turn it on. With it on, the places you
            have marked <span className="text-foreground">been there</span>{" "}
            appear on the map of anyone who follows you, with your name, your
            note and your rating on each — which is the point, since a place
            with nothing said about it is worth little to somebody standing in
            front of it. It never includes anywhere you marked{" "}
            <span className="text-foreground">lived there</span>, never your
            want-to-go list, and never journal entries. Turning it off removes
            them from other people&apos;s maps.
          </li>
          <li>
            <span className="text-foreground">Journal entries and photos are
            always private.</span> Publishing a trip does not publish them.
            Photos are stored so that they cannot be read by their URL — only
            through Roava, after checking it is you.
          </li>
          <li>
            <span className="text-foreground">Inviting someone to a trip</span>{" "}
            lets them edit that trip&apos;s itinerary. It gives them no access to
            anything else of yours.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Who else it talks to</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Google, to sign you in.</li>
          <li>
            OpenStreetMap-based services for map tiles and place search. What
            you type into the search box is sent to them to look up.
          </li>
          <li>
            Vercel and Neon, which host the app, its database and its photo
            storage.
          </li>
        </ul>
        <p className="text-muted">
          There is no advertising, no analytics tracking you across sites, and
          nothing is sold to anyone.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Deleting it</h2>
        <p className="text-muted">
          You can delete your account at any time from{" "}
          <Link href="/settings" className="text-accent-text underline">
            your profile
          </Link>
          . That removes your places, trips, journal entries and photos,
          including the photo files themselves. It cannot be undone, and there
          is no backup to restore from. Copies other people made of trips you
          published stay with them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Reporting something</h2>
        <p className="text-muted">
          Any public profile or published trip can be reported from its page.
          You can also block someone, which hides each of you from the other and
          removes any follows between you.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Getting in touch</h2>
        <p className="text-muted">
          {CONTACT ? (
            <>
              Email <span className="text-foreground">{CONTACT}</span>.
            </>
          ) : (
            "Contact details are configured by whoever runs this instance."
          )}
        </p>
      </section>
    </div>
  );
}
