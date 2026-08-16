import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import UniverseClient from "./UniverseClient";

/**
 * MyUniverse — the board, the day grid and the inbox on one screen.
 *
 * The board itself is fetched client-side rather than here, because `GET /boards`
 * is what provisions a personal board on first visit and the same call fills the
 * board switcher. Doing it in the client keeps one round trip doing both jobs and
 * lets a drag update state without a server round trip behind it.
 */
export default async function Page({
  searchParams,
}: {
  // The Google OAuth callback lands here, and this is the one thing on the page
  // that genuinely comes from the URL. Read on the server and handed down as a
  // prop rather than pulled off `window.location` in the client: it is known
  // before the first render, so making it state to be corrected afterwards
  // would render the page once without it for no reason.
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "boards.write")) return <NoAccess feature="MyUniverse" />;
  const { google, reason } = await searchParams;

  return (
    <UniverseClient
      canCapture={can(user, "capture.write")}
      canCreateTeamBoards={can(user, "boards.team")}
      canSyncCalendar={can(user, "calendar.sync")}
      currentUserId={user.id}
      googleOutcome={google ?? null}
      googleReason={reason ?? null}
    />
  );
}
