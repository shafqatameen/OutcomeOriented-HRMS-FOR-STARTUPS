/**
 * The app's own public origin.
 *
 * Needed by the metadata layer, which has to emit absolute URLs: an Open Graph
 * tag, a canonical link or a sitemap entry is read by machines that have no
 * page to resolve a relative path against. Nothing else in the app needs it —
 * the browser talks to the API through a same-origin `/api` prefix — so this is
 * not an API base.
 *
 * Server-side only, and deliberately *not* prefixed `NEXT_PUBLIC_`. That prefix
 * would inline the value at build time, baking whatever domain the build
 * machine happened to know into the output; the real domain is templated into
 * `deploy/Caddyfile` at install time, which is after the build. Every consumer
 * of this constant (robots.ts, sitemap.ts, the root layout's metadataBase, the
 * /login metadata) is a Server Component or route handler, so reading it at
 * runtime costs nothing and lets one build serve any domain.
 *
 * Same convention as INTERNAL_API_URL in lib/session.ts. The fallback is the
 * local dev origin, so an unset variable yields working localhost URLs rather
 * than a placeholder domain in production HTML.
 */
export const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";
