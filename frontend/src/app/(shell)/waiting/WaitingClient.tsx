"use client";

import { useCallback, useEffect, useState } from "react";
import { Hourglass, Trash2, Check, RotateCcw, Loader2 } from "lucide-react";
import {
  getWaiting,
  updateWaiting,
  deleteWaiting,
  type WaitingItem,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextHeader from "@/components/ContextHeader";

/**
 * Work that is somebody else's move.
 *
 * Sorted longest-waiting first, because that is the only ordering this list is
 * for: the item at the top is the one that has been quietly rotting, and it is
 * almost always the one worth a message today.
 *
 * `days_waiting` and `is_due` come from the API rather than being computed here,
 * so this page and any future reminder cannot disagree about whether something
 * is overdue for a chase.
 */
export default function WaitingClient() {
  const [items, setItems] = useState<WaitingItem[] | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WaitingItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(
    (closed: boolean) =>
      getWaiting(closed)
        .then((next) => { setItems(next); setError(null); })
        .catch((err) => {
          setItems([]);
          setError(err instanceof Error ? err.message : "Could not load your waiting list");
        }),
    [],
  );

  // Re-runs when the settled toggle flips, which is the only input this read has.
  useEffect(() => { load(includeClosed); }, [load, includeClosed]);

  const reload = () => load(includeClosed);

  const setStatus = async (item: WaitingItem, status: "Open" | "Closed") => {
    try {
      await updateWaiting(item.id, { status });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteWaiting(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete that");
    }
  };

  const count = items?.length ?? 0;
  const dueCount = items?.filter((i) => i.is_due).length ?? 0;

  return (
    <div className="space-y-6">
      <ContextHeader
        title="Waiting on"
        meta={count ? `${count} outstanding${dueCount ? ` · ${dueCount} to chase` : ""}` : undefined}
        actions={
          <Button variant="outline" size="sm" onClick={() => setIncludeClosed((v) => !v)}>
            {includeClosed ? "Hide settled" : "Show settled"}
          </Button>
        }
      />

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
            <Hourglass className="h-6 w-6 text-muted-foreground" />
            <div className="font-semibold">Nobody owes you anything</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Items land here when you clarify something as somebody else&rsquo;s move.
              Tracking it means you can stop carrying the reminder yourself.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Longest-waiting first. The one at the top has been outstanding the
            longest, which usually makes it the one worth a message today.
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const settled = item.status === "Closed";
              return (
                <li key={item.id}>
                  <Card className={settled ? "opacity-60" : undefined}>
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium wrap-break-word">{item.title}</span>
                          {item.is_due && <Badge variant="destructive">Chase now</Badge>}
                          {settled && <Badge variant="secondary">Settled</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {item.delegate_name} · {item.days_waiting}d
                          {item.follow_up_date && ` · chase ${item.follow_up_date}`}
                        </div>
                        {item.notes && (
                          <p className="mt-1 text-sm whitespace-pre-wrap wrap-break-word text-muted-foreground">
                            {item.notes}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={settled ? "Reopen — still outstanding" : "Mark as arrived"}
                        title={settled ? "Reopen" : "It arrived"}
                        onClick={() => setStatus(item, settled ? "Open" : "Closed")}
                      >
                        {settled ? <RotateCcw /> : <Check />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete this waiting item"
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
        title="Delete this?"
        description="If it simply arrived, mark it settled instead — that keeps the record of how long it took. Deleting removes it outright."
        confirmLabel="Delete"
        destructive
        error={deleteError}
        onConfirm={confirmDelete}
      >
        {pendingDelete && (
          <div className="rounded border bg-muted/50 p-3 text-sm wrap-break-word">
            {pendingDelete.title} — {pendingDelete.delegate_name}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
