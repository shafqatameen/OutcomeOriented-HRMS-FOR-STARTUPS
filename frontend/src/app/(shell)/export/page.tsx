import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import ExportClient from "./ExportClient";

export default async function ExportPage() {
  const user = await requireUser();
  if (!can(user, "data.export")) return <NoAccess feature="Data Export" />;
  return <ExportClient />;
}
