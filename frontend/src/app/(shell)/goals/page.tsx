import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import GoalsClient from "./GoalsClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "goals.view")) return <NoAccess feature="Goals" />;
  return <GoalsClient canManage={can(user, "admin.goals")} />;
}
