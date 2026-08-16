"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Trash2, Eye, Loader2 } from "lucide-react";
import {
  getSomeday,
  updateSomeday,
  deleteSomeday,
  type SomedayItem,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextHeader from "@/components/ContextHeader";

/**
 * Possibilities you have explicitly not committed to.
 *
 * This list is browsed, never processed. It carries no dates, no contexts and
 * no assignees — the absence is what makes it safe to put things here, and the
 * moment a someday item acquires a deadline it has stopped being one.
 *
 * The one number worth showing is how long something has sat unreviewed. The
 * method's instruction is to prune the possibilities the world has moved past,
 * and you cannot spot those without knowing which ones you have not looked at
 * since the day you wrote them down.
 */

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}+05:30`).getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function SomedayClient() {
  const [items, setItems] = useState<SomedayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SomedayItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = () =>
    getSomeday()
      .then((next) => { setItems(next); setError(null); })
      .catch((err) => {
        setItems([]);
        setError(err instanceof Error ? err.message : "Could not load your someday list");
      });

  useEffect(() => { reload(); }, []);

  const markReviewed = async (item: SomedayItem) => {
    try {
      await updateSomeday(item.id, { reviewed: true });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteSomeday(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete that");
    }
  };

  const count = items?.length ?? 0;

  return (
    <div className="space-y-6">
      <ContextHeader title="Someday / Maybe" meta={count ? `${count} possibilities` : undefined} />

      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : count === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Lightbulb className="h-6 w-6 text-muted-foreground" />
            <div className="font-semibold">Nothing parked yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Things land here when you clarify an inbox item as{" "}
              &ldquo;maybe one day&rdquo;. Nothing on this list is a commitment, and
              nothing on it will ever nag you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            None of this is committed to. Read it when you want ideas, not when you
            want work — and delete anything the world has moved past.
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const reviewed = ago(item.last_reviewed_at);
              return (
                <li key={item.id}>
                  <Card>
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium wrap-break-word">{item.title}</div>
                        {item.notes && (
                          <p className="mt-1 text-sm whitespace-pre-wrap wrap-break-word text-muted-foreground">
                            {item.notes}
                          </p>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {reviewed ? `Last looked at ${reviewed}` : "Never reviewed"}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Mark as reviewed"
                        title="I have looked at this again"
                        onClick={() => markReviewed(item)}
                      >
                        <Eye />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete this possibility"
                        title="Delete"
                        onClick={() => { setPendingDelete(item); setDeleteError(null); }}
                      >
                        <Trash2 />
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this possibility?"
        description="Deleted outright. Pruning this list is the point of reviewing it, so nothing is kept behind the scenes."
        confirmLabel="Delete"
        destructive
        error={deleteError}
        onConfirm={confirmDelete}
      >
        {pendingDelete && (
          <div className="rounded border bg-muted/50 p-3 text-sm wrap-break-word">
            {pendingDelete.title}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
