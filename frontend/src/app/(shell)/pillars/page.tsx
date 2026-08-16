import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import PillarsClient from "./PillarsClient";

/**
 * The whole pillar sheet. Gated on `panel.view` rather than `panel.view.all`,
 * because the sheet is only ever *someone's* mix: without the wider grant the
 * page still opens, scoped to the reader's own effort and with no person picker.
 * The API applies the same rule; this check only decides what to render.
 */
export default async function Page() {
  const user = await requireUser();
  if (!can(user, "panel.view")) return <NoAccess feature="Pillars" />;

  return (
    <PillarsClient
      self={{ id: user.id, name: user.name }}
      canViewAll={can(user, "panel.view.all")}
    />
  );
}
