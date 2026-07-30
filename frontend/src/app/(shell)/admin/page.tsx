import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AdminForm from "./AdminForm";
import GoalsAdminForm from "./GoalsAdminForm";
import CategoryAdminForm from "./CategoryAdminForm";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "Admin") {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">Signed in as {user.name.toUpperCase()}</p>
      <AdminForm />
      <GoalsAdminForm />
      <CategoryAdminForm />
    </div>
  );
}
