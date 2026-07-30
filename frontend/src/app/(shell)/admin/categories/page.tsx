import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ContextHeader from "@/components/ContextHeader";
import CategoryAdminForm from "../CategoryAdminForm";

export default async function AdminCategoriesPage() {
  const user = await requireUser();
  if (!can(user, "admin.categories")) return <NoAccess feature="Categories" />;

  return (
    <div className="space-y-6">
      <ContextHeader title="Categories" meta="Admin" />
      <CategoryAdminForm />
    </div>
  );
}
