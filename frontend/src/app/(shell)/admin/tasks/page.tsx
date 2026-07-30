import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ContextHeader from "@/components/ContextHeader";
import AdminForm from "../AdminForm";

export default async function AdminTasksPage() {
  const user = await requireUser();
  if (!can(user, "admin.tasks")) return <NoAccess feature="Assign Task" />;

  return (
    <div className="space-y-6">
      <ContextHeader title="Assign Task" meta="Admin" />
      <AdminForm />
    </div>
  );
}
