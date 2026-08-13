import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import TasksClient from "./TasksClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return <NoAccess feature="Tasks" />;
  return <TasksClient view={{ kind: "all" }} canManage={can(user, "admin.tasks")} />;
}
