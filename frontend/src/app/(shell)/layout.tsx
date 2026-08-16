import { can, getCurrentUser } from "@/lib/session";
import {
  getCategoriesServer,
  getGoalsServer,
  getInboxCountServer,
  getPillarsServer,
} from "@/lib/server-api";
import NavigationRail from "@/components/NavigationRail";
import ShellContent from "@/components/ShellContent";
import CaptureBar from "@/components/CaptureBar";
import StuffBar from "@/components/StuffBar";

/**
 * Authenticated app shell. The rail is mounted here so it persists across
 * navigation instead of remounting per route. Pages keep their own access
 * guards; this layout only needs the session and the rail's sub-item data.
 */
export default async function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, categories, goals, pillars, inboxCount] = await Promise.all([
    getCurrentUser(),
    getCategoriesServer(),
    getGoalsServer(),
    getPillarsServer(),
    getInboxCountServer(),
  ]);

  return (
    <div className="flex min-h-svh">
      {/* The rail is a long list of links standing between a keyboard user and
          the page they asked for. Off-screen until focused, first in the tab
          order, so Tab-then-Enter jumps the whole thing. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-sm focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <NavigationRail user={user} data={{ categories, goals, pillars, inboxCount }} />
      {/* Sole scroll and growth owner. The content cap lives inside, not on the
          viewport, so the rail cannot starve the content column. */}
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pt-14 md:pt-0">
        <ShellContent>{children}</ShellContent>
      </main>
      {/* Mounted at the shell rather than per route, because the whole point is
          that an open loop can be captured from wherever you happened to be
          when it turned up. */}
      {can(user, "capture.write") && <CaptureBar />}
      {/* Same argument, a different destination: `c` goes to the inbox, `s`
          straight onto the board's Stuff list. Gated on the board permission
          rather than the capture one, since that is what the write needs. */}
      {can(user, "boards.write") && <StuffBar />}
    </div>
  );
}
