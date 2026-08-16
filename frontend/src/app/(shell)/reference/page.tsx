import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ReferenceClient from "./ReferenceClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "lists.write")) return <NoAccess feature="Reference" />;
  return <ReferenceClient />;
}
