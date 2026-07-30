import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";

/** Admin surfaces in rail order, each with the permission that opens it. */
const ADMIN_SURFACES: { route: string; permission: string }[] = [
  { route: "/admin/tasks", permission: "admin.tasks" },
  { route: "/admin/goals", permission: "admin.goals" },
  { route: "/admin/categories", permission: "admin.categories" },
  { route: "/admin/access", permission: "admin.users" },
];

/**
 * /admin has no surface of its own. Land on the first child this account can
 * actually open, rather than always /admin/tasks, which someone granted only
 * Categories would hit as a wall.
 */
export default async function AdminPage() {
  const user = await requireUser();
  const first = ADMIN_SURFACES.find((surface) => can(user, surface.permission));
  if (!first) return <NoAccess feature="Administration" />;
  redirect(first.route);
}
