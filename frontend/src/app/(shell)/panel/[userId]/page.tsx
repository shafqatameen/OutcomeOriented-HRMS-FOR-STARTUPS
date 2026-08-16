import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import PanelClient from "../PanelClient";

/**
 * Someone else's panel. Your own id lands here too if linked directly, which is
 * why `panel.view` alone is enough for that case — the API applies the same
 * rule, and this check only decides what to render.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await requireUser();
  const { userId } = await params;
  const targetId = Number(userId);

  if (!Number.isInteger(targetId)) return <NoAccess feature="Panel" />;

  const isSelf = targetId === user.id;
  const permitted = isSelf ? can(user, "panel.view") : can(user, "panel.view.all");
  if (!permitted) return <NoAccess feature="Panel" />;

  // Completing from here is offered only on your own panel. The API refuses a
  // non-admin finishing someone else's task anyway, and an admin doing it by
  // accident from a page they opened to *read* is the likelier mistake.
  return (
    <PanelClient
      canComplete={isSelf && can(user, "tasks.complete")}
      userId={targetId}
    />
  );
}
