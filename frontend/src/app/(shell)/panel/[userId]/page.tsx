import type { Metadata } from "next";
import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import PanelClient from "../PanelClient";

/**
 * A static title, unlike the other dynamic routes. Naming the tab after the
 * person would mean a `/users` round-trip on every panel open purely for the
 * title — this page has no server-side read of its own to piggyback on — and it
 * would put a colleague's name in browser history for anyone permitted to look
 * at their panel. "Panel" is the cheaper and quieter answer.
 */
export const metadata: Metadata = { title: "Panel" };

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
