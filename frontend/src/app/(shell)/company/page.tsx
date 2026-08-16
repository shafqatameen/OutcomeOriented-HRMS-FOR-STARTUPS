import { can, requireUser } from "@/lib/session";
import NoAccess from "@/components/NoAccess";
import CompanyClient from "./CompanyClient";

/**
 * The company rollup. Gated on `panel.view.all` — the same grant that opens
 * anyone else's panel, since this view is that grant aggregated. The API
 * applies the same rule; this check only decides what to render.
 */
export default async function Page() {
  const user = await requireUser();
  if (!can(user, "panel.view.all")) return <NoAccess feature="Company Focus" />;
  return <CompanyClient />;
}
