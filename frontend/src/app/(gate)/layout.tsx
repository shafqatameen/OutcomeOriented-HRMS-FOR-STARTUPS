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
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
