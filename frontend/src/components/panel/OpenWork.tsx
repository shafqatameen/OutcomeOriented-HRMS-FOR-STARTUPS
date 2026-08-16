"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { completeTask } from "@/lib/api";
import { pillarInk, type OpenTask } from "@/lib/panel";

/**
 * Pending work, showing both tags so the panel's own vocabulary carries over
 * to the thing you actually act on.
 *
 * The minutes box is deliberately optional and deliberately blank: a guessed
 * duration would corrupt every share on this page, and an empty one only leaves
 * a gap. Completing without it keeps the pre-existing behaviour exactly.
 */
export default function OpenWork({
  tasks,
  canComplete,
  onCompleted,
}: {
  tasks: OpenTask[];
  canComplete: boolean;
  onCompleted: () => void;
}) {
  const [minutesById, setMinutesById] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async (task: OpenTask) => {
    const raw = (minutesById[task.task_id] ?? "").trim();
    const minutes = raw === "" ? undefined : Number(raw);

    if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0)) {
      setError("Minutes must be a number of zero or more.");
      return;
    }

    setBusyId(task.task_id);
    setError(null);
    try {
      await completeTask(task.task_id, minutes);
      setMinutesById(({ [task.task_id]: _removed, ...rest }) => rest);
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that task.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Open work · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing pending. Clear board.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <li
                key={task.task_id}
                className="flex flex-wrap items-center justify-between gap-3 border-l-[3px] py-1 pl-3"
                style={{ borderColor: pillarInk(task.pillar_slug) }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{task.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {task.track_name} · {task.pillar_name} › {task.function_name} ·{" "}
                    {task.points} {task.points === 1 ? "pt" : "pts"}
                  </div>
                </div>

                {canComplete && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="w-20"
                      placeholder="mins"
                      aria-label={`Minutes spent on ${task.title}`}
                      value={minutesById[task.task_id] ?? ""}
                      onChange={(event) =>
                        setMinutesById((current) => ({
                          ...current,
                          [task.task_id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === task.task_id}
                      onClick={() => handleComplete(task)}
                    >
                      {busyId === task.task_id ? "Saving…" : "Complete"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canComplete && tasks.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Minutes are optional. Logging them switches this panel from measuring
            points to measuring time — which is the only way hours in a
            zero-point track like Drain become visible.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
