"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarSync, Check, Loader2, RefreshCw, Unplug } from "lucide-react";
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  getGoogleCalendars,
  startGoogleCalendarAuth,
  syncGoogleCalendar,
  updateGoogleCalendarSettings,
  type GoogleCalendarChoice,
  type GoogleCalendarStatus,
  type GoogleSyncResult,
} from "@/lib/api";
import { parseIst } from "@/lib/board";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type GoogleCalendarDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Run after a sync that changed anything, so the board redraws. */
  onSynced: () => void;
};

/** A sync result as one sentence, or null when nothing moved. */
function describe(result: GoogleSyncResult): string | null {
  const parts: string[] = [];
  if (result.imported) parts.push(`${result.imported} brought in`);
  if (result.updated_locally) parts.push(`${result.updated_locally} updated here`);
  if (result.removed_locally) parts.push(`${result.removed_locally} moved to Trash`);
  if (result.exported) parts.push(`${result.exported} added to Google`);
  if (result.updated_remotely) parts.push(`${result.updated_remotely} updated on Google`);
  if (result.removed_remotely) parts.push(`${result.removed_remotely} removed from Google`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Connect, configure and run the Google Calendar sync.
 *
 * A dialog rather than a settings page because the thing it configures is on
 * screen behind it: the Planner. Connecting and then having to navigate back to
 * see whether anything arrived is how an integration gets set up once, badly,
 * and never checked again.
 *
 * Every state this can be in is shown rather than collapsed into "not working",
 * because they have different fixes and only one of them belongs to the person
 * reading. A server with no OAuth credentials is the administrator's job; a
 * revoked grant is a reconnect; a failed sync may be Google having a bad
 * minute. Saying which is what makes it actionable.
 */
export default function GoogleCalendarDialog({
  open,
  onOpenChange,
  onSynced,
}: GoogleCalendarDialogProps) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"none" | "connecting" | "syncing" | "saving">("none");
  const [result, setResult] = useState<GoogleSyncResult | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getGoogleCalendarStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the calendar settings");
      return null;
    }
  }, []);

  // Re-read on every open rather than once on mount: the connection can be
  // changed from another tab, and a grant can be revoked from Google's own
  // security page, neither of which this component would otherwise hear about.
  // `live` guards against a slow read landing on a dialog already closed again.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      try {
        const next = await getGoogleCalendarStatus();
        if (!live) return;
        setStatus(next);
        setResult(null);
        setError(null);
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : "Could not read the calendar settings");
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  // Deferred until the dialog is open *and* connected: listing calendars is a
  // live call to Google, and making it on every page load would spend somebody
  // else's API quota to fill a dropdown nobody opened.
  useEffect(() => {
    if (!open || !status?.connected || calendars !== null) return;
    getGoogleCalendars()
      .then(setCalendars)
      .catch((err) => {
        // Said out loud rather than swallowed: the picker below falls back to
        // the calendar already in use, and an unexplained one-entry dropdown
        // looks like a bug rather than like Google being unreachable.
        setCalendars([]);
        setError(err instanceof Error ? err.message : "Could not list your calendars");
      });
  }, [open, status?.connected, calendars]);

  const connect = async () => {
    setBusy("connecting");
    setError(null);
    try {
      const { authorization_url } = await startGoogleCalendarAuth();
      // A full navigation, not a popup: consent screens routinely refuse to
      // render in one, and the callback returns to this page anyway.
      window.location.href = authorization_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the Google sign-in");
      setBusy("none");
    }
  };

  const save = async (data: Parameters<typeof updateGoogleCalendarSettings>[0]) => {
    setBusy("saving");
    setError(null);
    try {
      setStatus(await updateGoogleCalendarSettings(data));
      // Switching calendars invalidates every card↔event link, so anything the
      // board is showing may have changed underneath it.
      if (data.calendar_id) onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
      await load();
    } finally {
      setBusy("none");
    }
  };

  const runSync = async () => {
    setBusy("syncing");
    setError(null);
    setResult(null);
    try {
      const outcome = await syncGoogleCalendar();
      setResult(outcome);
      await load();
      if (describe(outcome)) onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sync failed");
      await load();
    } finally {
      setBusy("none");
    }
  };

  const disconnect = async () => {
    await disconnectGoogleCalendar();
    setCalendars(null);
    setResult(null);
    setConfirmingDisconnect(false);
    await load();
    onSynced();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Google Calendar</DialogTitle>
            <DialogDescription>
              Your own Google account, connected to your own board. Nobody else on this
              installation can see or reach it.
            </DialogDescription>
          </DialogHeader>

          {status === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </p>
          ) : !status.configured ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">This server has no Google credentials yet.</p>
              <p className="text-muted-foreground">
                Whoever runs it needs to create an OAuth client at{" "}
                <span className="font-mono text-xs">console.cloud.google.com</span>, enable
                the Google Calendar API, and set{" "}
                <span className="font-mono text-xs">GOOGLE_CLIENT_ID</span>,{" "}
                <span className="font-mono text-xs">GOOGLE_CLIENT_SECRET</span> and{" "}
                <span className="font-mono text-xs">GOOGLE_REDIRECT_URI</span> in the
                backend environment. The steps are in{" "}
                <span className="font-mono text-xs">backend/.env.example</span>.
              </p>
            </div>
          ) : !status.connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Connecting brings your events onto the Planner as cards, and puts every card
                you give a date on your calendar. Both directions can be switched off after.
              </p>
              <Button onClick={connect} disabled={busy === "connecting"}>
                {busy === "connecting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarSync className="h-4 w-4" />
                )}
                Connect Google Calendar
              </Button>
              {status.last_sync_error && (
                <p className="text-xs text-destructive">{status.last_sync_error}</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                <span className="font-medium">{status.google_email ?? "Connected"}</span>
                <span className="text-xs text-muted-foreground">
                  {status.last_sync_at
                    ? `Last synced ${parseIst(status.last_sync_at).toLocaleString()}`
                    : "Not synced yet"}
                </span>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase text-muted-foreground">
                  Calendar
                </span>
                <Select
                  value={status.calendar_id ?? "primary"}
                  disabled={busy !== "none" || calendars === null}
                  onChange={(event) => save({ calendar_id: event.target.value })}
                  className="w-full"
                >
                  {/* The calendar in use always has an option of its own, even
                      when the list could not be fetched — Google being briefly
                      unreachable must not leave this control blank, which would
                      read as "no calendar is set" when one very much is. */}
                  {!(calendars ?? []).some((choice) => choice.id === status.calendar_id) && (
                    <option value={status.calendar_id ?? "primary"}>
                      {calendars === null
                        ? "Loading…"
                        : (status.calendar_name ?? status.calendar_id ?? "primary")}
                    </option>
                  )}
                  {(calendars ?? []).map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                      {choice.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Changing this starts over: cards stop claiming to be events on the old
                  calendar, and the next sync rebuilds against the new one.
                </span>
              </label>

              <fieldset className="space-y-2">
                <legend className="text-[11px] font-medium uppercase text-muted-foreground">
                  Directions
                </legend>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={status.pull_enabled}
                    disabled={busy !== "none"}
                    onChange={(event) => save({ pull_enabled: event.target.checked })}
                  />
                  <span>
                    Bring Google events onto the board
                    <span className="block text-[11px] text-muted-foreground">
                      They arrive in the Calendar list as ordinary cards — draggable,
                      editable, and drawn on the Planner.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={status.push_enabled}
                    disabled={busy !== "none"}
                    onChange={(event) => save({ push_enabled: event.target.checked })}
                  />
                  <span>
                    Put dated cards on Google
                    <span className="block text-[11px] text-muted-foreground">
                      Every card with a due date, wherever it sits on the board — not only
                      the ones filed under Calendar.
                    </span>
                  </span>
                </label>
              </fieldset>

              <fieldset className="space-y-1">
                <legend className="text-[11px] font-medium uppercase text-muted-foreground">
                  Window
                </legend>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={status.past_days}
                    disabled={busy !== "none"}
                    onChange={(event) =>
                      setStatus({ ...status, past_days: Number(event.target.value) })
                    }
                    onBlur={(event) => save({ past_days: Number(event.target.value) })}
                    className="w-20"
                    aria-label="Days back"
                  />
                  <span className="text-xs text-muted-foreground">days back and</span>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={status.future_days}
                    disabled={busy !== "none"}
                    onChange={(event) =>
                      setStatus({ ...status, future_days: Number(event.target.value) })
                    }
                    onBlur={(event) => save({ future_days: Number(event.target.value) })}
                    className="w-20"
                    aria-label="Days ahead"
                  />
                  <span className="text-xs text-muted-foreground">days ahead</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  A calendar has no end in either direction. Bounding it is what keeps a
                  weekly recurrence from filling the board with three years of meetings.
                </p>
              </fieldset>

              {result && (
                <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                  {describe(result) ?? "Already in step — nothing to change."}
                </p>
              )}
              {result?.errors.map((problem) => (
                <p key={problem} className="text-xs text-destructive">
                  {problem}
                </p>
              ))}
              {!result && status.last_sync_error && (
                <p className="text-xs text-destructive">{status.last_sync_error}</p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {status?.connected && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmingDisconnect(true)}
                  disabled={busy !== "none"}
                >
                  <Unplug className="h-4 w-4" /> Disconnect
                </Button>
                <Button onClick={runSync} disabled={busy !== "none"}>
                  {busy === "syncing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Sync now
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title="Disconnect Google Calendar?"
        description={
          <>
            This app&rsquo;s access to your calendar is revoked at Google, and nothing here syncs
            again until you reconnect. Cards that came from the calendar stay on the board —
            you may have worked on them, and a dropped connection is no reason to throw away
            your week. Events already on Google stay too.
          </>
        }
        confirmLabel="Disconnect"
        destructive
        onConfirm={disconnect}
      />
    </>
  );
}
