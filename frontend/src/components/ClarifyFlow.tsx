"use client";

import { useMemo, useState } from "react";
import { Loader2, ArrowLeft, Check } from "lucide-react";
import {
  clarifyInboxItem,
  type ClarifyRequest,
  type InboxItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The clarify decision tree, one item at a time.
 *
 * Deliberately not a row of buttons on the inbox list. Asking "what is this?"
 * from a list view is how people skim for the easy item and leave the awkward
 * ones to rot; the method's instruction is top item first, one at a time, all
 * the way to zero. So this takes over the screen, shows exactly one capture,
 * and offers no way to reorder or skip ahead.
 *
 * The two-minute step comes before everything else on purpose. It is the one
 * branch that removes work from the system entirely rather than filing it, and
 * asking it late means filing things you could simply have finished.
 *
 * There is no "back to inbox" outcome, because there is no such outcome. Once
 * an item is in front of you it leaves as something — the only way out without
 * deciding is to close the flow, which leaves it untouched for next time.
 */

type Step = "actionable" | "twoMinute" | "multiStep" | "yours" | "form";
type FormKind = "reference" | "someday" | "waiting" | "next_action" | "project";

export type ClarifyOptions = {
  categories: { id: number; name: string; default_points: number }[];
  goals: { id: number; title: string }[];
  people: { id: number; name: string }[];
  /** Whether this session may create scored work. Presentation only — the API enforces it. */
  canCreateTasks: boolean;
  canCreateProjects: boolean;
};

type ClarifyFlowProps = {
  item: InboxItem;
  options: ClarifyOptions;
  /** Called after the item has left the inbox. */
  onDone: (summary: string) => void;
  onClose: () => void;
  /** How many are left including this one, for the progress line. */
  remaining: number;
};

const firstLine = (text: string) =>
  text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";

export default function ClarifyFlow({
  item,
  options,
  onDone,
  onClose,
  remaining,
}: ClarifyFlowProps) {
  const [step, setStep] = useState<Step>("actionable");
  const [history, setHistory] = useState<Step[]>([]);
  const [kind, setKind] = useState<FormKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state, shared across the kinds since only one is ever mounted.
  //
  // Nothing here resets when the flow moves to the next capture, because it
  // never has to: the caller keys this component by item id, so a new capture
  // is a new mount with fresh state. That is also the only way to be sure a
  // half-typed delegate name from the previous decision cannot leak into this
  // one — a reset effect has to remember every field, and a key cannot forget.
  const [title, setTitle] = useState(() => firstLine(item.body));
  const [notes, setNotes] = useState("");
  const [delegateUserId, setDelegateUserId] = useState<string>("");
  const [delegateName, setDelegateName] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [goalId, setGoalId] = useState<string>("");
  const [firstAction, setFirstAction] = useState("");

  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setError(null);
    setStep(next);
  };

  const back = () => {
    setError(null);
    setHistory((h) => {
      const previous = h[h.length - 1];
      if (previous) setStep(previous);
      return h.slice(0, -1);
    });
  };

  const openForm = (which: FormKind) => {
    setKind(which);
    go("form");
  };

  const submit = async (request: ClarifyRequest) => {
    setBusy(true);
    setError(null);
    try {
      const result = await clarifyInboxItem(item.id, request);
      onDone(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not file that");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = useMemo(() => {
    if (kind === "waiting") return Boolean(title.trim() && (delegateUserId || delegateName.trim()));
    if (kind === "next_action") return Boolean(title.trim() && categoryId);
    if (kind === "project") return Boolean(title.trim() && goalId && firstAction.trim() && categoryId);
    return Boolean(title.trim());
  }, [kind, title, delegateUserId, delegateName, categoryId, goalId, firstAction]);

  const send = () => {
    if (!kind) return;
    const base = { title: title.trim() };
    if (kind === "reference") return submit({ outcome: "reference", ...base, body: item.body });
    if (kind === "someday")
      return submit({ outcome: "someday", ...base, notes: notes.trim() || undefined });
    if (kind === "waiting")
      return submit({
        outcome: "waiting", ...base,
        notes: notes.trim() || undefined,
        delegate_user_id: delegateUserId ? Number(delegateUserId) : undefined,
        delegate_name: delegateUserId ? undefined : delegateName.trim(),
        follow_up_date: followUp || undefined,
      });
    if (kind === "next_action")
      return submit({ outcome: "next_action", ...base, category_id: Number(categoryId) });
    if (kind === "project")
      return submit({
        outcome: "project", ...base,
        goal_id: Number(goalId),
        first_action_title: firstAction.trim(),
        category_id: Number(categoryId),
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={back} aria-label="Back a step">
              <ArrowLeft />
            </Button>
          )}
          <span className="font-heading text-base font-medium">Clarify</span>
          <span className="text-sm text-muted-foreground">
            {remaining} left
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Stop for now
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-8">
        {/* The capture stays on screen through every step. The decision is about
            these exact words, and re-reading them is most of the work. */}
        <blockquote className="rounded-lg border-l-2 border-primary bg-muted/50 p-4 text-sm whitespace-pre-wrap wrap-break-word">
          {item.body}
        </blockquote>

        {error && (
          <div className="rounded border border-destructive/50 p-3 text-sm wrap-anywhere text-destructive">
            {error}
          </div>
        )}

        {step === "actionable" && (
          <Question
            prompt="Is there anything to do about this?"
            hint="Not everything is an action. Most of what turns up is material to keep or a possibility to sit on."
          >
            <Choice onClick={() => go("twoMinute")} label="Yes, something needs doing" primary />
            <Choice onClick={() => openForm("reference")} label="No — it's just something to keep"
              hint="Files it as reference. Keeps the whole capture as the note." />
            <Choice onClick={() => openForm("someday")} label="No — but maybe one day"
              hint="Someday/Maybe. Not a commitment, and it will never nag you." />
            <Choice onClick={() => submit({ outcome: "trash" })} label="No — bin it" destructive />
          </Question>
        )}

        {step === "twoMinute" && (
          <Question
            prompt="Would it take less than two minutes?"
            hint="If so, the cheapest thing you will ever do with it is do it now. Filing it costs more than finishing it."
          >
            <Choice
              onClick={() => submit({ outcome: "trash" })}
              label="I just did it"
              hint="Removes it entirely. Nothing to track — it's finished."
              primary
            />
            <Choice onClick={() => go("multiStep")} label="No, it's bigger than that" />
          </Question>
        )}

        {step === "multiStep" && (
          <Question
            prompt="Does it take more than one step?"
            hint="An outcome needing several steps is a project. A project is not a big task — it is a result you want, with actions underneath it."
          >
            <Choice
              onClick={() => openForm("project")}
              label="Yes — it's a project"
              hint={
                options.canCreateProjects
                  ? "Asks for the outcome and the very first action."
                  : "Needs the admin.goals and admin.tasks grants on your account."
              }
              disabled={!options.canCreateProjects}
            />
            <Choice onClick={() => go("yours")} label="No — it's a single action" primary />
          </Question>
        )}

        {step === "yours" && (
          <Question
            prompt="Is it yours to do?"
            hint="If somebody else owes it, the only thing you are holding is the reminder to chase them."
          >
            <Choice
              onClick={() => openForm("next_action")}
              label="Mine — make it a next action"
              hint={
                options.canCreateTasks
                  ? "Goes on the task board, priced by its category."
                  : "Putting work on the scored board needs the admin.tasks grant on your account."
              }
              disabled={!options.canCreateTasks}
              primary={options.canCreateTasks}
            />
            <Choice
              onClick={() => openForm("waiting")}
              label="Somebody else's — I'm waiting on them"
              hint="Tracks who owes it and how long it has been outstanding."
              primary={!options.canCreateTasks}
            />
          </Question>
        )}

        {step === "form" && kind && (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-medium">
              {kind === "reference" && "Keep it as reference"}
              {kind === "someday" && "Park it in Someday/Maybe"}
              {kind === "waiting" && "Who are you waiting on?"}
              {kind === "next_action" && "What is the next physical action?"}
              {kind === "project" && "What does done look like?"}
            </h2>

            <Field
              label={kind === "project" ? "Outcome — the project's name" : "Title"}
              hint={
                kind === "next_action"
                  ? "Start with a verb: Call, Draft, Buy, Email. A topic is not an action."
                  : kind === "project"
                    ? "State the result, not the activity — \"Website V2 launched\", not \"work on website\"."
                    : undefined
              }
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>

            {kind === "project" && (
              <>
                <Field label="Goal it sits under">
                  <Select value={goalId} onChange={setGoalId} placeholder="Pick a goal">
                    {options.goals.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="The very first action"
                  hint="Required. A project without one does not move — you find out months later, and by then nobody remembers why."
                >
                  <Input
                    value={firstAction}
                    onChange={(e) => setFirstAction(e.target.value)}
                    placeholder="Review the homepage with Anwar"
                  />
                </Field>
              </>
            )}

            {(kind === "next_action" || kind === "project") && (
              <Field label="Category" hint="This is what prices it.">
                <Select value={categoryId} onChange={setCategoryId} placeholder="Pick a category">
                  {options.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.default_points} pts)
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {kind === "waiting" && (
              <>
                <Field label="Who owes it">
                  <Select
                    value={delegateUserId}
                    onChange={(v) => { setDelegateUserId(v); if (v) setDelegateName(""); }}
                    placeholder="Someone not listed…"
                  >
                    {options.people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                {!delegateUserId && (
                  <Field label="…or type a name" hint="Suppliers, clients, anyone without an account here.">
                    <Input
                      value={delegateName}
                      onChange={(e) => setDelegateName(e.target.value)}
                      placeholder="Anwar"
                    />
                  </Field>
                )}
                <Field label="Chase on" hint="Optional. Leave empty if there is no date worth nagging you.">
                  <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
                </Field>
              </>
            )}

            {(kind === "someday" || kind === "waiting") && (
              <Field label="Notes" hint="Optional.">
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                />
              </Field>
            )}

            {kind === "reference" && (
              <p className="text-sm text-muted-foreground">
                The captured text above is kept as the note, in full.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={back} disabled={busy}>
                Back
              </Button>
              <Button onClick={send} disabled={busy || !canSubmit}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                File it
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Question({
  prompt,
  hint,
  children,
}: {
  prompt: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-medium">{prompt}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Choice({
  label,
  hint,
  onClick,
  primary = false,
  destructive = false,
  disabled = false,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left text-sm transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        disabled
          ? "cursor-not-allowed border-dashed opacity-60"
          : primary
            ? "border-primary bg-primary/5 hover:bg-primary/10"
            : destructive
              ? "hover:border-destructive/50 hover:bg-destructive/5"
              : "hover:bg-secondary",
      )}
    >
      <span className="font-medium">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** A bare select styled like the Input primitive, since the ui/select is a listbox. */
function Select({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}
