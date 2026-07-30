import { can, requireUser } from "@/lib/session";
import ContextHeader from "@/components/ContextHeader";
import NoAccess from "@/components/NoAccess";
import AccessForm from "./AccessForm";

export default async function AdminAccessPage() {
  const user = await requireUser();
  if (!can(user, "admin.users")) return <NoAccess feature="Access" />;

  return (
    <div className="space-y-6">
      <ContextHeader title="Access" meta="Admin" />
      <AccessForm />
    </div>
  );
}
