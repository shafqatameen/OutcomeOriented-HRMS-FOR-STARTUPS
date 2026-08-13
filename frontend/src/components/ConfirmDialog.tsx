"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Blast radius, a reassignment picker — whatever the decision needs. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red fill on the confirm button. Reserve for deletes. */
  destructive?: boolean;
  /** Blocks confirmation while a required choice is still missing. */
  confirmDisabled?: boolean;
  error?: string | null;
  /** Rejecting leaves the dialog open so the error stays on screen. */
  onConfirm: () => void | Promise<void>;
};

/**
 * Ask-then-act, for anything that cannot be undone.
 *
 * Owns the in-flight state itself so no caller has to thread a `busy` flag
 * through: the confirm button spins, both buttons lock, and a rejected promise
 * keeps the dialog open rather than closing over a failure the user never saw.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      // Dismissing mid-request would strand the operation with no feedback.
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        {error && (
          // wrap-anywhere, not wrap-break-word: an API message can be a single
          // token with no break opportunity in it at all, and a stack-shaped one
          // would otherwise push a scrollbar under the whole dialog.
          <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || confirmDisabled}
            // DESIGN.md keeps the solid red fill for confirmation dialogs only;
            // the destructive variant elsewhere is the tinted one.
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
