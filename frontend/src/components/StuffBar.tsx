"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, Loader2 } from "lucide-react";
import { createCard, getMyBoard } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Dump straight into Stuff, from anywhere in the app — press `s`.
 *
 * A sibling of CaptureBar rather than a mode of it, and the split is worth
 * stating because the two look almost identical on screen:
 *
 * - `c` captures into the **inbox** (`inbox_items`), which is a holding pen for
 *   things that have not been decided about and must still go through Clarify.
 * - `s` puts a card into the **Stuff list** on your board, which is already a
 *   place on the board — you can drag it, date it, give it a checklist.
 *
 * Merging them into one dialog with a destination picker was the obvious
 * alternative and is the wrong one: CaptureBar's whole design rule is that it
 * asks no questions, and a radio button for "where does this go?" is exactly the
 * decision that makes people keep the thought in their head instead. Two keys,
 * each with one destination, keeps both paths free of choices.
 *
 * The rest of the behaviour is deliberately copied from CaptureBar, for the same
 * reasons it gives: one field, stays open after saving, and a failed request
 * gives the words back rather than losing them.
 *
 * Mounted in the shell layout, so it is present on every authenticated route.
 */

/** Milliseconds the "Added" acknowledgement stays up. */
const ACK_DURATION = 1400;

/** Fired after a session of dumping, so an open MyUniverse can re-read itself. */
export const BOARD_CHANGED_EVENT = "board:changed";

type StuffList = { id: number; name: string };

export default function StuffBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<StuffList | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The board is fetched on first open, never on mount: this component sits on
  // every page in the app, and a board read per page load is a real cost paid by
  // everyone to benefit the one press in a hundred that actually opens it.
  const listRef = useRef<StuffList | null>(null);
  const boardIdRef = useRef<number | null>(null);
  const pending = useRef<Promise<StuffList> | null>(null);
  // Whether this session wrote anything, kept apart from `savedCount` because
  // that one is an acknowledgement that fades after a second and a half. Reusing
  // it here would mean a card added, then paused over, closes without telling
  // MyUniverse anything.
  const dirty = useRef(false);

  const resolveList = useCallback((): Promise<StuffList> => {
    if (listRef.current) return Promise.resolve(listRef.current);
    if (!pending.current) {
      pending.current = getMyBoard()
        .then((board) => {
          // Keyed off `role`, not `name`, because renaming a seeded list keeps
          // its role — a board whose Stuff column now reads "Brain dump" is
          // still the list this shortcut means.
          const found = board.lists.find((candidate) => candidate.role === "stuff");
          if (!found) {
            throw new Error("Your board has no Stuff list. Add one on MyUniverse first.");
          }
          boardIdRef.current = board.id;
          listRef.current = { id: found.id, name: found.name };
          setList(listRef.current);
          return listRef.current;
        })
        .catch((err) => {
          // Cleared so the next open retries. A board that failed to load once
          // is usually a dropped request, not a permanent verdict.
          pending.current = null;
          throw err;
        });
    }
    return pending.current;
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    setError(null);
    // Started now rather than at the first Enter, so a missing Stuff list is on
    // screen before anything has been typed into a field that cannot save.
    resolveList().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not find your Stuff list"),
    );
  }, [resolveList]);

  const close = useCallback(() => {
    setIsOpen(false);
    setBody("");
    setError(null);
    setSavedCount(0);
    // MyUniverse holds the board in component state and has no idea cards were
    // just added underneath it. Told once, on close, rather than per save:
    // reloading the board on every Enter would fight the typing it sits over.
    if (dirty.current && boardIdRef.current !== null) {
      window.dispatchEvent(
        new CustomEvent(BOARD_CHANGED_EVENT, { detail: { boardId: boardIdRef.current } }),
      );
    }
    dirty.current = false;
  }, []);

  // Global, because the thought turns up while you are looking at some other
  // page — that is the only time this is ever needed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        close();
        return;
      }
      if (event.key !== "s" || event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal the key from somebody mid-sentence in another field. This is
      // also what keeps `s` and CaptureBar's `c` from firing into each other's
      // open dialog, since both focus a textarea the moment they open.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }

      event.preventDefault();
      open();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, open, close]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => () => {
    if (ackTimer.current) clearTimeout(ackTimer.current);
  }, []);

  const save = async () => {
    const text = body.trim();
    if (!text || isSaving) return;

    // Cleared before the request, not after: the point of the next few hundred
    // milliseconds is that you can already be typing the next thought into them.
    setBody("");
    setError(null);
    setIsSaving(true);
    try {
      const target = await resolveList();
      await createCard(target.id, { title: text });
      dirty.current = true;
      setSavedCount((n) => n + 1);
      if (ackTimer.current) clearTimeout(ackTimer.current);
      ackTimer.current = setTimeout(() => setSavedCount(0), ACK_DURATION);
    } catch (err) {
      // Give the words back. Losing a thought to a failed request is the single
      // worst thing this component could do — it is precisely the failure that
      // stops people trusting the system enough to keep using it.
      setBody((current) => (current ? `${text}\n${current}` : text));
      setError(err instanceof Error ? err.message : "Could not add that to Stuff");
      inputRef.current?.focus();
    } finally {
      setIsSaving(false);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter saves; Shift+Enter is how you write the second line of a longer one.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  };

  const listName = list?.name ?? "Stuff";

  if (!isOpen) {
    return (
      // Stacked above CaptureBar's button and one size down: both are dumping
      // grounds, but the inbox is the one you should reach for without thinking,
      // and two identical circles would make you stop and pick.
      <button
        type="button"
        onClick={open}
        aria-label="Dump into Stuff (press s)"
        title="Dump into Stuff — press s"
        className={cn(
          "fixed bottom-20 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full",
          "border border-border bg-secondary text-secondary-foreground shadow-md",
          "transition-transform hover:scale-105",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <Brain className="h-4 w-4" />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/20 supports-backdrop-filter:backdrop-blur-xs"
        onClick={close}
        aria-hidden
      />
      {/* Positioned high rather than centred, like the capture panel: it opens
          over whatever you were reading, and the thing being dumped is often on
          that page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Add to ${listName}`}
        className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border bg-popover p-4 shadow-xl"
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <label htmlFor="stuff-body" className="flex items-center gap-1.5 font-heading text-base font-medium">
            <Brain className="h-4 w-4 shrink-0" />
            Dump it into {listName}
          </label>
          <span className="text-xs text-muted-foreground">
            Enter to add &middot; Esc to close
          </span>
        </div>

        <textarea
          id="stuff-body"
          ref={inputRef}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Whatever just crossed your mind."
          className={cn(
            "w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
          )}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div aria-live="polite" className="min-w-0 text-xs">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedCount > 0 ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Check className="h-3 w-3 shrink-0" />
                Added{savedCount > 1 ? ` ×${savedCount}` : ""} to {listName} — keep going
              </span>
            ) : (
              <span className="text-muted-foreground">
                It goes on the board as a card. Sort it out later.
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={close}>
              Done
            </Button>
            <Button size="sm" onClick={save} disabled={!body.trim() || isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Add
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
