import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ContextHeader from "@/components/ContextHeader";
import PeopleAdminForm from "./PeopleAdminForm";

export default async function AdminPeoplePage() {
  const user = await requireUser();
  if (!can(user, "admin.users")) return <NoAccess feature="People" />;

  // Passed down so the form can grey out the actions the API would refuse
  // anyway: nobody may deactivate or delete the account they are signed in as.
  return (
    <div className="space-y-6">
      <ContextHeader title="People" meta="Admin" />
      <PeopleAdminForm currentUserId={user.id} />
    </div>
  );
}
