import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ContextHeader from "@/components/ContextHeader";
import OrgAdminForm from "./OrgAdminForm";

export default async function AdminOrgPage() {
  const user = await requireUser();
  if (!can(user, "admin.taxonomy")) return <NoAccess feature="Pillars & Functions" />;

  return (
    <div className="space-y-6">
      <ContextHeader title="Pillars & Functions" meta="Admin" />
      <OrgAdminForm />
    </div>
  );
}
