/**
 * Pre-authentication routes. Deliberately outside the shell: a user with nowhere
 * to navigate should not be shown a navigation region.
 */
export default function GateLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // A `main` rather than a plain wrapper: these pages have no rail and so no
    // skip link, and without a main landmark a screen reader has nothing to jump
    // to — the whole page reads as one undifferentiated region.
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
