import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ContextHeader from "@/components/ContextHeader";
import GoalsAdminForm from "../GoalsAdminForm";

export default async function AdminGoalsPage() {
  const user = await requireUser();
  if (!can(user, "admin.goals")) return <NoAccess feature="Goals & Milestones" />;

  return (
    <div className="space-y-6">
      <ContextHeader title="Goals & Milestones" meta="Admin" />
      <GoalsAdminForm />
    </div>
  );
}
