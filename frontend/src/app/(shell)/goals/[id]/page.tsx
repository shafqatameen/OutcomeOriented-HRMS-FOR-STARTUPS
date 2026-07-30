import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/session";
import { getGoalsServer } from "@/lib/server-api";
import NoAccess from "@/components/NoAccess";
import GoalsClient from "../GoalsClient";

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

  return <GoalsClient goalId={goalId} title={goal.title} />;
}
