import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Root 404. Next serves this for any unmatched URL across the app, and it
 * renders inside the document shell rather than the (shell) layout - so the
 * navigation rail is not here, and the page has to carry its own way back.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        404
      </p>
      <h1 className="mt-2 text-lg font-bold">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-[60ch] text-muted-foreground">
        The address may be mistyped, or whatever was here has since been
        renamed or deleted.
      </p>

      <nav aria-label="Recovery links" className="mt-6 flex flex-wrap gap-4">
        <Link
          href="/"
          className="text-primary underline underline-offset-4 hover:no-underline"
        >
          Leaderboard
        </Link>
        <Link
          href="/tasks"
          className="text-primary underline underline-offset-4 hover:no-underline"
        >
          Tasks
        </Link>
        <Link
          href="/goals"
          className="text-primary underline underline-offset-4 hover:no-underline"
        >
          Goals
        </Link>
      </nav>
    </main>
  );
}
