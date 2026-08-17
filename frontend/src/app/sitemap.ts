import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * One entry, and that is not an oversight.
 *
 * A sitemap lists the pages a crawler should know about, and this app has
 * exactly one: /login, which carries the description of the product. Every
 * other route redirects to it unless you are signed in, so listing them would
 * publish an inventory of the internal route structure in exchange for nothing.
 *
 * Kept as a file rather than dropped entirely so the intent is written down —
 * the next person to add a public page has an obvious place to add it, instead
 * of wondering whether the omission was deliberate.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
