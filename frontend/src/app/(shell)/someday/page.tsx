import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import SomedayClient from "./SomedayClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "lists.write")) return <NoAccess feature="Someday / Maybe" />;
  return <SomedayClient />;
}
