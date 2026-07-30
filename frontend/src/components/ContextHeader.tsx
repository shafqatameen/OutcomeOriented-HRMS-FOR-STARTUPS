import type { ReactNode } from "react";

type ContextHeaderProps = {
  title: string;
  /** Short qualifier beside the title, e.g. a count or the active scope. */
  meta?: string;
  /** Page-level actions. The primary action of a route belongs here and nowhere else. */
  actions?: ReactNode;
};

/**
 * Per-route title band inside the workspace. Exactly one per route — it carries the
 * page identity the removed top bar used to hold, and scrolls with the content.
 */
export default function ContextHeader({ title, meta, actions }: ContextHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-2xl font-bold">{title}</h1>
        {meta && <span className="text-sm text-muted-foreground">{meta}</span>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
