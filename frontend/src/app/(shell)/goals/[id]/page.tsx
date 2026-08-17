import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import { getGoalsServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import GoalsClient from "../GoalsClient";

/**
 * Names the browser tab after the goal, so a window with four of these open is
 * still navigable and a bookmark records which goal it points at.
 *
 * The `getGoalsServer` call is the same one the page makes; Next memoizes the
 * underlying fetch across `generateMetadata` and the component, so this costs
 * no extra request. Falls through to the layout default when the goal is
 * missing or unreadable rather than guessing — the page itself will 404.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const goal = (await getGoalsServer()).find((g) => g.id === Number(id));
  return goal ? { title: goal.title } : {};
}

/**
 * A single goal and its milestones. The title is resolved server-side so the
 * heading is right on first paint, and an unknown id 404s.
 */
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, "goals.view")) return <NoAccess feature="Goals" />;
  const { id } = await params;

  const goalId = Number(id);
  if (!Number.isInteger(goalId)) notFound();

  const goals = await getGoalsServer();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) notFound();

  return <GoalsClient goalId={goalId} title={goal.title} canManage={can(user, "admin.goals")} />;
}
