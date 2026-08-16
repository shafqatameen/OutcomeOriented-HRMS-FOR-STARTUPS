"use client";

import { useState } from "react";
import { ArrowRight, Inbox as InboxIcon, Loader2, Plus, Trash2 } from "lucide-react";
import type { BoardListView, InboxItem } from "@/lib/api";
import CardFace from "@/components/board/CardFace";
import { cardDragId, zoneDragId } from "@/components/board/ids";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CapturePaneProps = {
  /** The board's `inbox`-role list, if it still has one. */
  inboxList: BoardListView | undefined;
  /** Unclarified captures from the global capture bar, or null while loading. */
  captures: InboxItem[] | null;
  captureError: string | null;
  writable: boolean;
  onAddCard: (title: string) => Promise<void>;
  onOpenCard: (cardId: number) => void;
  onFileCapture: (item: InboxItem) => Promise<void>;
  onDiscardCapture: (item: InboxItem) => Promise<void>;
};

/**
 * The Inbox pane: one narrow column for everything not yet decided about.
 *
 * It shows two things, and the split is the point. Above are captures made from
 * the capture bar — rows in `inbox_items`, which hold nothing but text and a
 * timestamp because capture has to stay faster than the urge to skip it. Below is
 * the board's own Inbox list, whose cards can already carry dates and checklists.
 *
 * Keeping both here rather than pretending one is the other means a thought
 * written down anywhere in the app has exactly one place to surface, and moving it
 * onto the board stays a deliberate act rather than something that happened while
 * you were typing.
 */
export default function CapturePane({
  inboxList,
  captures,
  captureError,
  writable,
  onAddCard,
  onOpenCard,
  onFileCapture,
  onDiscardCapture,
}: CapturePaneProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [filing, setFiling] = useState<number | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: inboxList ? zoneDragId(inboxList.id) : "zone:none",
    disabled: !inboxList,
  });

  const submit = async () => {
    const title = draft.trim();
    if (!title || busy || !inboxList) return;
    setBusy(true);
    try {
      await onAddCard(title);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const file = async (item: InboxItem, action: (item: InboxItem) => Promise<void>) => {
    setFiling(item.id);
    try {
      await action(item);
    } finally {
      setFiling(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {writable && inboxList && (
        <div className="pb-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Add a card"
            aria-label="Add a card to the Inbox list"
            className="w-full resize-none rounded-sm border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {draft.trim() && (
            <Button size="sm" className="mt-1" onClick={submit} disabled={busy}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {/* Captures first, and above the cards, because they are the only rows on
            this page that carry an obligation: an inbox item has never been
            decided about, and until it is, every other count on the rail is
            provisional. */}
        {captures !== null && captures.length > 0 && (
          <section aria-label="Captured, not yet on the board" className="space-y-2">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <InboxIcon className="h-3 w-3" /> Captured ({captures.length})
            </h3>
            {captures.map((item) => (
              <div
                key={item.id}
                className="rounded-sm border border-dashed border-border bg-card/60 px-2 py-1.5"
              >
                <p className="text-sm wrap-break-word">{item.body}</p>
                <div className="mt-1 flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => file(item, onFileCapture)}
                    disabled={filing === item.id || !inboxList}
                    title={
                      inboxList
                        ? "Put this on the board as a card"
                        : "This board has no Inbox list to file into"
                    }
                  >
                    {filing === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowRight className="h-3 w-3" />
                    )}
                    To board
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => file(item, onDiscardCapture)}
                    disabled={filing === item.id}
                    className="text-destructive"
                    title="Throw this away unprocessed"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        {captureError && <p className="text-xs text-destructive">{captureError}</p>}

        {inboxList ? (
          <section aria-label={inboxList.name} className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {inboxList.name} ({inboxList.cards.length})
            </h3>
            <div
              ref={setNodeRef}
              className={cn("min-h-16 space-y-2 rounded-sm", isOver && "bg-primary/5")}
            >
              <SortableContext
                items={inboxList.cards.map((card) => cardDragId(card.id))}
                strategy={verticalListSortingStrategy}
              >
                {inboxList.cards.map((card) => (
                  <CardFace key={card.id} card={card} onOpen={onOpenCard} draggable={writable} />
                ))}
              </SortableContext>
              {inboxList.cards.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Empty. That is the goal.
                </p>
              )}
            </div>
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">
            This board has no Inbox list. Add one on the board and it appears here.
          </p>
        )}
      </div>
    </div>
  );
}
