import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Keep the workspace out of search indexes; let the front door in.
 *
 * Everything under (shell) is behind `requireUser()`, so a crawler that
 * followed one of those URLs would only ever be handed a redirect — but it
 * would still have learned the route exists, and the route names alone describe
 * the org. `Disallow: /` is the default answer for this app.
 *
 * /login is the exception, because it is now also the page describing what the
 * product is. Crawlers resolve conflicting rules by longest match, so the more
 * specific `Allow` wins for that one path without loosening anything else. The
 * (gate) forms — /signup, /verify, /reset-password — stay disallowed: a bare
 * form is not a useful search result.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/login",
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
