import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import PanelClient from "./PanelClient";

export default async function Page() {
  const user = await requireUser();
  if (!can(user, "panel.view")) return <NoAccess feature="Panel" />;
  return <PanelClient canComplete={can(user, "tasks.complete")} />;
}
