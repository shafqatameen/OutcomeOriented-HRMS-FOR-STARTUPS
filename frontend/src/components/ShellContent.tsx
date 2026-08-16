"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Routes that get the full width of the workspace instead of the reading cap. */
const FULL_BLEED = ["/universe"];

/**
 * The content column inside the app shell.
 *
 * Every route in this app is a document — a table, a form, a panel — and reads
 * better capped at a comfortable measure, which is why the shell has always
 * pinned content to `max-w-6xl`. MyUniverse is the exception: a Kanban board is
 * as wide as its columns, and a cap there does not shorten the line length, it
 * just hides two lists behind a scrollbar that did not need to exist.
 *
 * A Client Component because the decision is route-dependent and layouts do not
 * see the pathname. It renders nothing of its own beyond the wrapper.
 */
export default function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <div
      className={cn(
        "mx-auto space-y-6 px-4 py-6 md:px-8 md:py-8",
        fullBleed ? "w-full" : "max-w-6xl",
      )}
    >
      {children}
    </div>
  );
}
