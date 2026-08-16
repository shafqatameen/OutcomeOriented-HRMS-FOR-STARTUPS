"use client";

import { useEffect, useMemo, useState } from "react";
import { BookMarked, Trash2, Loader2, Search } from "lucide-react";
import { getReference, deleteReference, type ReferenceItem } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextHeader from "@/components/ContextHeader";

/**
 * Material, not commitments.
 *
 * Reference carries no status at all — there is nothing about a wifi password
 * to be done or not done — so this page offers no completion, no dates and no
 * progress. The only thing it needs to be good at is letting you find something
 * again, which is why the filter is the primary control.
 *
 * Filtering is client-side because reference lists are small and personal; when
 * one is big enough to need a server-side search, the search will belong to the
 * app-wide one rather than to this page.
 */
export default function ReferenceClient() {
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ReferenceItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = () =>
    getReference()
      .then((next) => { setItems(next); setError(null); })
      .catch((err) => {
        setItems([]);
        setError(err instanceof Error ? err.message : "Could not load your reference notes");
      });

  useEffect(() => { reload(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !items) return items ?? [];
    // Title and body both, since half of what you look for is a detail inside
    // the note rather than the name you gave it.
    return items.filter(
      (i) => i.title.toLowerCase().includes(needle) || i.body.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteReference(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete that");
    }
  };

  const count = items?.length ?? 0;

  return (
    <div className="space-y-6">
      <ContextHeader
        title="Reference"
        meta={
          count
            ? query.trim()
              ? `${visible.length} of ${count}`
              : `${count} notes`
            : undefined
        }
      />

      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
          {error}
        </div>
      )}

      {count > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find something"
            aria-label="Filter reference notes"
            className="pl-9"
          />
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      ) : count === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <BookMarked className="h-6 w-6 text-muted-foreground" />
            <div className="font-semibold">Nothing filed yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Notes land here when you clarify an inbox item as something to keep
              rather than something to do. Much of what crosses your desk is this.
            </p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Nothing matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium wrap-break-word">{item.title}</div>
                    <p className="mt-1 text-sm whitespace-pre-wrap wrap-break-word text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete this note"
                    title="Delete"
                    onClick={() => { setPendingDelete(item); setDeleteError(null); }}
                  >
                    <Trash2 />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this note?"
        description="Deleted outright — reference notes are not archived anywhere else."
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
