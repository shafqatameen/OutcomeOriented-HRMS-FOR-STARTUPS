import { requireUser } from "@/lib/session";
import LeaderboardClient from "./LeaderboardClient";

export default async function Page() {
  await requireUser();
  return <LeaderboardClient />;
}
