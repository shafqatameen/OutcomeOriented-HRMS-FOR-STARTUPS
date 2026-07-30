import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import TasksClient from "../TasksClient";

export default async function TasksHistoryPage() {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return <NoAccess feature="Task History" />;
  return <TasksClient view={{ kind: "history" }} />;
}
