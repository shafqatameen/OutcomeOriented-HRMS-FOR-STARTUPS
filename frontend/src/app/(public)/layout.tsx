/**
 * The public front door — currently just /login, which doubles as the page that
 * explains what this app is.
 *
 * Its own group rather than a corner of (gate): those are narrow utility forms
 * capped at `max-w-sm`, and a page describing the product needs the full
 * 960px measure DESIGN.md gives every other page. Sharing a layout would have
 * meant one of the two fighting the other's width.
 */
export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-svh">{children}</div>;
}
