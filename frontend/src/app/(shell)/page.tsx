import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import LeaderboardClient from "./LeaderboardClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "leaderboard.view")) return <NoAccess feature="Leaderboard" />;
  return <LeaderboardClient />;
}
