"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trophy, Menu, X, PanelLeftClose, PanelLeftOpen, Lock, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildDestinations,
  isDestinationActive,
  isDestinationPermitted,
  isSubDestinationActive,
  type NavigationData,
} from "@/lib/navigation";
import LogoutButton from "@/components/LogoutButton";
import { can, type SessionUser } from "@/lib/access";

const COLLAPSE_KEY = "oo.layout.navigationRail.isCollapsed";

/**
 * Collapse preference lives in localStorage rather than React state so it survives
 * reloads, and is read through useSyncExternalStore so the server render and the
 * first client render agree without a setState-in-effect round trip.
 */
const collapseListeners = new Set<() => void>();

function subscribeCollapsed(onStoreChange: () => void) {
  collapseListeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    collapseListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getCollapsedSnapshot() {
  return window.localStorage.getItem(COLLAPSE_KEY) === "true";
}

function getCollapsedServerSnapshot() {
  return false;
}

function writeCollapsed(isCollapsed: boolean) {
  window.localStorage.setItem(COLLAPSE_KEY, String(isCollapsed));
  collapseListeners.forEach((notify) => notify());
}

type NavigationRailProps = {
  user: SessionUser | null;
  /** Feeds the dynamic sub-items under Tasks and Goals. */
  data: NavigationData;
};

export default function NavigationRail({ user, data }: NavigationRailProps) {
  const pathname = usePathname();
  const destinations = buildDestinations(data);
  const allows = (key: string) => can(user, key);
  const isCollapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );

  // Storing the route the overlay was opened on means any completed navigation
  // dismisses it, without an effect watching the pathname.
  const [overlayPathname, setOverlayPathname] = useState<string | null>(null);
  const isOverlayOpen = overlayPathname !== null && overlayPathname === pathname;

  const destinationsRef = useRef<HTMLElement | null>(null);

  /** Arrow traversal within the destination group, matching app-shell conventions. */
  const handleDestinationKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const items = Array.from(
      destinationsRef.current?.querySelectorAll<HTMLElement>("[data-destination]") ?? [],
    ).filter((item) => item.getAttribute("aria-disabled") !== "true");
    if (items.length === 0) return;

    const current = items.findIndex((item) => item === document.activeElement);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;

    event.preventDefault();
    items[target]?.focus();
  };

  const showLabels = !isCollapsed || isOverlayOpen;

  return (
    <>
      {/* Compact-viewport trigger. The rail is the only navigation surface, so it
          always needs a way back when it is overlaid. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOverlayPathname(pathname)}
          aria-label="Open navigation"
          aria-expanded={isOverlayOpen}
          className="-ml-2 rounded-md p-2 text-foreground hover:bg-secondary"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <Trophy className="h-5 w-5" />
          OutcomeOriented
        </Link>
      </div>

      {isOverlayOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 md:hidden"
          onClick={() => setOverlayPathname(null)}
          aria-hidden
        />
      )}

      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-150",
          "md:sticky md:top-0 md:z-auto md:h-svh md:translate-x-0 md:transition-[width]",
          isOverlayOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "md:w-16" : "md:w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b",
            showLabels ? "justify-between px-4" : "justify-center px-2",
          )}
        >
          {showLabels && (
            <Link href="/" className="flex items-center gap-2 font-bold text-primary">
              <Trophy className="h-5 w-5 shrink-0" />
              <span className="truncate">OutcomeOriented</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => writeCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="hidden rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:block"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setOverlayPathname(null)}
            aria-label="Close navigation"
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          ref={destinationsRef}
          onKeyDown={handleDestinationKeys}
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-2"
        >
          {destinations.map((destination) => {
            const { id, label, route, glyph: Glyph, children } = destination;
            const isRestricted = !isDestinationPermitted(destination, allows);
            const isActive = isDestinationActive(route, pathname);
            // Sub-items the account cannot open are removed, not disabled: the
            // parent already communicates the section, and a wall of locked rows
            // is noise.
            const visibleChildren = (children ?? []).filter(
              (child) => !child.permission || allows(child.permission),
            );
            // Children stay out of the way until their parent is the active context,
            // and collapse away entirely with the rail.
            const showChildren = visibleChildren.length > 0 && isActive && !isRestricted && showLabels;

            const row = cn(
              "relative flex items-center gap-3 rounded-md py-2 text-sm font-medium",
              showLabels ? "px-3" : "justify-center px-0",
              isRestricted
                ? "cursor-not-allowed text-muted-foreground/60"
                : isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            );

            const body = (
              <>
                {isActive && !isRestricted && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                  />
                )}
                <Glyph
                  className={cn("h-4 w-4 shrink-0", isActive && !isRestricted && "text-primary")}
                />
                <span className={cn("truncate", !showLabels && "sr-only")}>{label}</span>
                {isRestricted && showLabels && (
                  <Lock className="ml-auto h-3 w-3 shrink-0" aria-hidden />
                )}
              </>
            );

            if (isRestricted) {
              return (
                <span
                  key={id}
                  data-destination={id}
                  aria-disabled="true"
                  title="Your account does not have access to this feature"
                  className={row}
                >
                  {body}
                </span>
              );
            }

            return (
              <div key={id} className="contents">
                <Link
                  href={route}
                  data-destination={id}
                  aria-current={isActive && !showChildren ? "page" : undefined}
                  title={showLabels ? undefined : label}
                  className={row}
                >
                  {body}
                </Link>

                {showChildren && (
                  <ul className="mb-1 flex flex-col gap-0.5">
                    {visibleChildren.map((child) => {
                      const isChildActive = isSubDestinationActive(child.route, pathname);
                      return (
                        <li key={child.id}>
                          <Link
                            href={child.route}
                            data-destination={child.id}
                            aria-current={isChildActive ? "page" : undefined}
                            // Goal and category names are user-supplied and can
                            // outrun the rail, so keep the full text reachable.
                            title={child.label}
                            className={cn(
                              "relative ml-4 flex items-center gap-2 rounded-md py-1.5 pl-4 pr-3 text-sm",
                              "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-border",
                              isChildActive
                                ? "bg-secondary font-medium text-foreground before:bg-primary before:w-0.5"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                          >
                            <child.glyph className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{child.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t p-2">
          {user ? (
            <div
              className={cn("flex flex-col gap-1", showLabels ? "px-1 py-1" : "items-center px-0")}
            >
              {showLabels && (
                <div className="truncate px-2 text-xs text-muted-foreground">
                  {user.name.toUpperCase()} ({user.role})
                </div>
              )}
              <div className={cn(showLabels ? "px-2" : "px-0")}>
                <LogoutButton iconOnly={!showLabels} />
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              title={showLabels ? undefined : "Login"}
              className={cn(
                "flex items-center gap-3 rounded-md py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
                showLabels ? "px-3" : "justify-center px-0",
              )}
            >
              <LogIn className="h-4 w-4 shrink-0" />
              <span className={cn(!showLabels && "sr-only")}>Login</span>
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
