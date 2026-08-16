"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { captureItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Capture, from anywhere in the app.
 *
 * The whole method rests on this being faster than the urge to skip it, so the
 * design rules here are unusually strict and are worth stating:
 *
 * - **One field, no options.** No category, no date, no assignee. Every control
 *   is a decision demanded at the moment of typing, and a capture form that asks
 *   questions is one people avoid by keeping the thought in their head — which
 *   is the exact thing the inbox exists to prevent. Those decisions belong to
 *   Clarify, later, in a place built for them.
 * - **It stays open after saving.** Thoughts arrive in clusters. Closing after
 *   one would make emptying your head an N-times-repeated ritual.
 * - **It never blocks on the network.** The field clears the moment you hit
 *   Enter so the next thought can go in immediately; a failure re-fills it
 *   rather than losing what you typed.
 *
 * Mounted in the shell layout, so it is present on every authenticated route.
 */

/** Milliseconds the "Captured" acknowledgement stays up. */
const ACK_DURATION = 1400;

export default function CaptureBar() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setBody("");
    setError(null);
    setSavedCount(0);
    // The rail's badge is rendered by a Server Component in the layout, so it
    // only learns about new captures when the route data is re-fetched. Done on
    // close rather than per save: refreshing under a still-open panel would
    // fight the typing it is sitting on top of.
    router.refresh();
  }, [router]);

  // A global shortcut, because an open loop turns up while you are looking at
  // some other page — that is the only time capture is ever needed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        close();
        return;
      }
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal the key from somebody mid-sentence in another field.
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
      await captureItem(text);
      setSavedCount((n) => n + 1);
      if (ackTimer.current) clearTimeout(ackTimer.current);
      ackTimer.current = setTimeout(() => setSavedCount(0), ACK_DURATION);
    } catch (err) {
      // Give the words back. Losing a captured thought to a failed request is
      // the single worst thing this component could do — it is precisely the
      // failure that stops people trusting the system enough to use it.
      setBody((current) => (current ? `${text}\n${current}` : text));
      setError(err instanceof Error ? err.message : "Could not capture that");
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

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Capture (press c)"
        title="Capture — press c"
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <Plus className="h-5 w-5" />
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
      {/* Positioned high rather than centred: it opens over whatever you were
          reading, and the thing you are capturing is often on that page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Capture to inbox"
        className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border bg-popover p-4 shadow-xl"
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <label htmlFor="capture-body" className="font-heading text-base font-medium">
            What&rsquo;s on your mind?
          </label>
          <span className="text-xs text-muted-foreground">
            Enter to capture &middot; Esc to close
          </span>
        </div>

        <textarea
          id="capture-body"
          ref={inputRef}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Anything. Sort it out later."
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
                Captured{savedCount > 1 ? ` ×${savedCount}` : ""} — keep going
              </span>
            ) : (
              <span className="text-muted-foreground">
                Don&rsquo;t decide what it is. Just get it out of your head.
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={close}>
              Done
            </Button>
            <Button size="sm" onClick={save} disabled={!body.trim() || isSaving}>
              Capture
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
