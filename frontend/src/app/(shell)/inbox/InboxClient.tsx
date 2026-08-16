"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox as InboxIcon, Trash2, Loader2, Check, ListChecks } from "lucide-react";
import {
  getInbox,
  getUsers,
  discardInboxItem,
  type InboxItem,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextHeader from "@/components/ContextHeader";
import ClarifyFlow, { type ClarifyOptions } from "@/components/ClarifyFlow";

/** Ages in whole units, biggest that fits. Precision past "3d" is not decision-relevant. */
function age(iso: string): string {
  // The API sends IST wall-clock without an offset, which Date would otherwise
  // read as UTC and report as hours in the future.
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}+05:30`).getTime();
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

type InboxClientProps = {
  categories: { id: number; name: string; default_points: number }[];
  goals: { id: number; title: string }[];
  canCreateTasks: boolean;
  canCreateProjects: boolean;
};

export default function InboxClient({
  categories,
  goals,
  canCreateTasks,
  canCreateProjects,
}: InboxClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<InboxItem | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);

  /** Index into `items` while clarifying, or null when not. */
  const [clarifyingAt, setClarifyingAt] = useState<number | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const reload = () =>
    getInbox()
      .then((next) => {
        setItems(next);
        setLoadError(null);
        return next;
      })
      .catch((err) => {
        setItems([]);
        setLoadError(err instanceof Error ? err.message : "Could not load your inbox");
        return [] as InboxItem[];
      });

  useEffect(() => {
    reload();
    // The delegate picker is a convenience; failing to load it must not stop
    // anyone clarifying, since a waiting item can always name someone as text.
    getUsers()
      .then((all) => setPeople(all.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }))))
      .catch(() => setPeople([]));
  }, []);

  const confirmDiscard = async () => {
    if (!pendingDiscard) return;
    setDiscardError(null);
    try {
      await discardInboxItem(pendingDiscard.id);
      setPendingDiscard(null);
      await reload();
      // The rail's badge is server-rendered in the shell layout and would
      // otherwise keep the old count until a hard reload.
      router.refresh();
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : "Could not discard that");
    }
  };

  /**
   * Advances to the next capture after one is filed.
   *
   * The list is re-read rather than spliced locally, because clarifying is the
   * one place two devices realistically collide — phone captures, laptop
   * clarifies. Holding the index rather than the item id means the flow lands
   * on whatever is now in that position, which after a removal is the next one.
   */
  const handleFiled = async (summary: string) => {
    setLastSummary(summary);
    const next = await reload();
    router.refresh();
    setClarifyingAt((at) => (at === null ? null : at < next.length ? at : null));
  };

  const count = items?.length ?? 0;
  const clarifyOptions: ClarifyOptions = {
    categories,
    goals,
    people,
    canCreateTasks,
    canCreateProjects,
  };
  const current =
    clarifyingAt !== null && items && clarifyingAt < items.length ? items[clarifyingAt] : null;

  return (
    <div className="space-y-6">
      <ContextHeader
        title="Inbox"
        meta={items === null ? undefined : count === 0 ? "empty" : `${count} to clarify`}
        actions={
          count > 0 ? (
            <Button onClick={() => { setLastSummary(null); setClarifyingAt(0); }}>
              <ListChecks className="mr-2 h-4 w-4" />
              Clarify
            </Button>
          ) : undefined
        }
      />

      {loadError && (
        <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
          {loadError}
        </div>
      )}

      {lastSummary && clarifyingAt === null && (
        <div className="flex items-center gap-2 rounded border border-primary/40 bg-primary/5 p-3 text-sm">
          <Check className="h-4 w-4 shrink-0 text-primary" />
          {lastSummary}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      ) : count === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <InboxIcon className="h-6 w-6 text-muted-foreground" />
            <div className="font-semibold">Nothing waiting</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              An empty inbox is the point, not an empty page. Press{" "}
              <kbd className="rounded border px-1 font-mono text-xs">c</kbd> anywhere
              in the app to capture the next thing that turns up.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Oldest first — the order to work through them in. Clarify takes them one
            at a time, from the top, until there are none left.
          </p>

          <ul className="flex flex-col gap-2">
            {items.map((item, index) => (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex items-start gap-3 p-3">
                    {/* whitespace-pre-wrap: a capture is verbatim, and multi-line
                        ones were typed that way on purpose. */}
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm wrap-break-word">
                      {item.body}
                    </p>
                    <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {age(item.created_at)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => { setLastSummary(null); setClarifyingAt(index); }}
                    >
                      Clarify
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Discard this item"
                      title="Discard"
                      onClick={() => {
                        setPendingDiscard(item);
                        setDiscardError(null);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {current && (
        <ClarifyFlow
          // Keyed by the capture, so moving to the next one is a fresh mount
          // rather than a pile of resets that could miss a field.
          key={current.id}
          item={current}
          options={clarifyOptions}
          remaining={count - (clarifyingAt ?? 0)}
          onDone={handleFiled}
          onClose={() => setClarifyingAt(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null);
        }}
        title="Discard this?"
        description="It is deleted outright, not archived — an inbox item has no points and no history behind it, so there is nothing to recover it from."
        confirmLabel="Discard"
        destructive
        error={discardError}
        onConfirm={confirmDiscard}
      >
        {pendingDiscard && (
          <div className="rounded border bg-muted/50 p-3 text-sm whitespace-pre-wrap wrap-break-word">
            {pendingDiscard.body}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
