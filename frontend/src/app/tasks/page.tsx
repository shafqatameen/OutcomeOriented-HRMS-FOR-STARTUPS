import { requireUser } from "@/lib/session";
import TasksClient from "./TasksClient";

export default async function Page() {
  const user = await requireUser();
  return <TasksClient />;
}
