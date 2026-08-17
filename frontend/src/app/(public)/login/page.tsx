import type { Metadata } from "next";
import Link from "next/link";
import {
  Trophy,
  Orbit,
  Target,
  LayoutGrid,
  ShieldCheck,
  Download,
  type LucideIcon,
} from "lucide-react";
import { SITE_URL } from "@/lib/site";
import LoginForm from "./LoginForm";

const DESCRIPTION =
  "OutcomeOriented tracks what a small team actually finishes. Tasks carry point values, completed work books those points to a leaderboard, and the same effort rolls up against goals, milestones and your own org taxonomy.";

/**
 * The one page in this app that wants to be found.
 *
 * The root layout sends `noindex, nofollow` for everything, which is right for a
 * workspace sitting behind `requireUser()` — but wrong here, so this route opts
 * back in. The override is deliberately narrow: /signup and the password-reset
 * pages stay out of the index, because a bare form is not worth a search result
 * and the account it creates needs an administrator's approval anyway.
 */
export const metadata: Metadata = {
  title: "A task board that keeps score",
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/login" },
  openGraph: {
    title: "OutcomeOriented — a task board that keeps score",
    description: DESCRIPTION,
    url: `${SITE_URL}/login`,
    siteName: "OutcomeOriented",
    type: "website",
  },
};

type Feature = {
  glyph: LucideIcon;
  title: string;
  body: string;
};

/**
 * What the app does, in the order someone meeting it would need to hear it:
 * where work enters, how it is scored, what it is scored against, and who can
 * change any of that.
 */
const FEATURES: Feature[] = [
  {
    glyph: Orbit,
    title: "Capture first, decide later",
    body: "MyUniverse is one workspace with three panes — an inbox for anything not yet thought about, a day planner, and the board it all ends up on. A keystroke captures from wherever you were, so an open loop never has to survive in your head until you reach the right page.",
  },
  {
    glyph: Trophy,
    title: "Points, then a leaderboard",
    body: "Every task category carries a default point value, and finishing a task books those points. The leaderboard charts them over any date range and breaks them down per category, so the standing is a record of completed work rather than a claim about it.",
  },
  {
    glyph: Target,
    title: "Goals broken into milestones",
    body: "A goal is a list of milestones with progress tracked against them, reachable straight from the navigation rail down to the individual milestone. Tasks connect to the goal they serve, so effort and intent are visible on the same screen.",
  },
  {
    glyph: LayoutGrid,
    title: "Pillars and functions, not just tags",
    body: "Work maps onto your organisation's own taxonomy of pillars and the functions beneath them. My Panel shows where one person's effort actually went; Company Focus is the same question for the whole team, including the functions nobody touched.",
  },
  {
    glyph: ShieldCheck,
    title: "Access granted per feature",
    body: "Permissions are individual feature keys, not a handful of fixed roles — one person can be given the categories admin without the rest of it. New accounts wait for an administrator to approve them before they can sign in.",
  },
  {
    glyph: Download,
    title: "Your data, exportable",
    body: "The full task and point history can be exported whenever you want it. Nothing recorded here is only reachable through this interface.",
  },
];

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-[960px] px-4 py-10 md:py-14">
      <header>
        <p className="flex items-center gap-2 font-bold text-primary">
          <Trophy className="h-5 w-5 shrink-0" aria-hidden />
          OutcomeOriented
        </p>
        <h1 className="mt-4 max-w-[22ch] text-2xl leading-tight font-bold md:text-3xl">
          A task board that keeps score
        </h1>
        <p className="mt-3 max-w-[68ch] text-muted-foreground">{DESCRIPTION}</p>
      </header>

      {/* The form leads on a narrow screen: someone who already has an account
          is the majority of this page's traffic, and they should not have to
          scroll past the pitch to reach it. On a wide screen both are above the
          fold anyway, so source order reverts to reading order. */}
      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="features-heading" className="order-2 lg:order-1">
          <h2 id="features-heading" className="sr-only">
            What OutcomeOriented does
          </h2>
          <ul className="divide-y divide-border border-y border-border">
            {FEATURES.map(({ glyph: Glyph, title, body }) => (
              <li key={title} className="flex gap-3 py-4">
                <Glyph className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-1 max-w-[68ch] text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="order-1 lg:order-2 lg:sticky lg:top-10">
          <LoginForm />
        </div>
      </div>

      <footer className="mt-12 border-t border-border pt-4 text-muted-foreground">
        <p>
          Accounts are approved by an administrator before first sign-in.{" "}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Request one
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}
