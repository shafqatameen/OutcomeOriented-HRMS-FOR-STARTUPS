import { can, requireUser } from "@/lib/session";
import { getCategoriesServer, getGoalsServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import InboxClient from "./InboxClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "capture.write")) return <NoAccess feature="Inbox" />;

  // Resolved here so the clarify flow has its pickers filled before the first
  // decision, rather than popping options in after the question is on screen.
  const [categories, goals] = await Promise.all([getCategoriesServer(), getGoalsServer()]);

  return (
    <InboxClient
      categories={categories}
      goals={goals}
      canCreateTasks={can(user, "admin.tasks")}
      canCreateProjects={can(user, "admin.goals") && can(user, "admin.tasks")}
    />
  );
}
