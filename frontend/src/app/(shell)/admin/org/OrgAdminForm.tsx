"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  asDeletionBlocked,
  createFunction,
  deleteFunction,
  getFunctionUsage,
  getOrgTree,
  getUsers,
  setUserSeat,
  updateFunction,
  type DeletionBlocked,
} from "@/lib/api";
import { pillarFill, pillarInk, type OrgPillar } from "@/lib/panel";
import { Select } from "@/components/ui/select";
import { Check, PlusCircle, Trash2, X } from "lucide-react";

type Person = { id: number; name: string; role: string; home_function_id: number | null };
type Usage = { function_id: number; name: string; task_count: number; seated_user_count: number };

export default function OrgAdminForm() {
  const [tree, setTree] = useState<OrgPillar[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newPillarId, setNewPillarId] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPurpose, setEditPurpose] = useState("");

  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [blocked, setBlocked] = useState<DeletionBlocked | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getOrgTree().then(setTree).catch((e: Error) => setError(e.message));
    getUsers().then(setPeople).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const allFunctions = tree.flatMap((pillar) =>
    pillar.functions.map((fn) => ({ ...fn, pillarName: pillar.name, pillarSlug: pillar.slug })),
  );

  const handleAddFunction = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await createFunction({
        pillar_id: Number(newPillarId),
        name: newName.trim(),
        purpose: newPurpose.trim() || undefined,
      });
      setNewName("");
      setNewPurpose("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that function.");
    }
  };

  const handleSaveEdit = async (functionId: number) => {
    setError(null);
    try {
      await updateFunction(functionId, {
        name: editName.trim(),
        purpose: editPurpose.trim(),
      });
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that function.");
    }
  };

  // Usage is fetched before the dialog asks, so the blast radius is on screen
  // when the decision is made rather than after it.
  const startDelete = async (fn: { id: number; name: string }) => {
    setPendingDelete(fn);
    setBlocked(null);
    setDeleteError(null);
    setUsage(null);
    try {
      setUsage(await getFunctionUsage(fn.id));
    } catch {
      // A missing count is not worth blocking the dialog over; the API refuses
      // the delete itself if anything still points at this function.
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteFunction(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (err) {
      setBlocked(asDeletionBlocked(err));
      setDeleteError(err instanceof Error ? err.message : "Could not delete that function.");
    }
  };

  const handleSeatChange = async (userId: number, value: string) => {
    setError(null);
    try {
      await setUserSeat(userId, value === "" ? null : Number(value));
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set that seat.");
    }
  };

  const blockedByUsage = (usage?.task_count ?? 0) > 0 || (usage?.seated_user_count ?? 0) > 0;

  return (
    <>
      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pillars &amp; Functions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The domain axis: what kind of work a task is. Separate from the track
            (Core, Adjacent, Spiritual, Drain), which says what the work is worth.
            A task carries one of each.
          </p>

          {tree.map((pillar) => (
            <div
              key={pillar.id}
              className="space-y-1 border-l-[3px] pl-3"
              style={{ borderColor: pillarInk(pillar.slug) }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-[2px] ring-1 ring-foreground/20"
                  style={{ background: pillarFill(pillar.slug) }}
                />
                <span className="font-semibold" style={{ color: pillarInk(pillar.slug) }}>
                  {pillar.name}
                </span>
                {!pillar.is_company && (
                  <Badge variant="outline" className="text-muted-foreground">
                    not company work
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {pillar.functions.length}{" "}
                  {pillar.functions.length === 1 ? "function" : "functions"}
                </span>
              </div>

              <ul className="flex flex-col gap-1">
                {pillar.functions.map((fn) => (
                  <li
                    key={fn.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                  >
                    {editingId === fn.id ? (
                      <>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="max-w-56"
                            placeholder="Function name"
                          />
                          <Input
                            value={editPurpose}
                            onChange={(e) => setEditPurpose(e.target.value)}
                            className="min-w-40 flex-1"
                            placeholder="Purpose"
                          />
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button type="button" size="sm" onClick={() => handleSaveEdit(fn.id)}>
                            <Check className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <div className="font-medium">{fn.name}</div>
                          {fn.purpose && (
                            <div className="text-xs text-muted-foreground">{fn.purpose}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(fn.id);
                              setEditName(fn.name);
                              setEditPurpose(fn.purpose ?? "");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => startDelete({ id: fn.id, name: fn.name })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <form onSubmit={handleAddFunction} className="space-y-3 border-t pt-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Pillar</label>
                <Select
                  className="w-full"
                  value={newPillarId}
                  onChange={(e) => setNewPillarId(e.target.value)}
                  required
                >
                  <option value="">Select pillar</option>
                  {tree.map((pillar) => (
                    <option key={pillar.id} value={pillar.id}>
                      {pillar.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Function name</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Purpose (optional)</label>
                <Input value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)} />
              </div>
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="size-4" />
              Add Function
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The function each person is meant to be working in. A seat restricts
            nothing — it gives their panel something to measure drift against.
            Everyone gets one, because everyone is CEO of their own life.
          </p>

          {people.map((person) => (
            <div
              key={person.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{person.name}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {person.role}
                </Badge>
              </div>
              <Select
                aria-label={`Seat for ${person.name}`}
                className="min-w-56"
                value={person.home_function_id ?? ""}
                onChange={(e) => handleSeatChange(person.id, e.target.value)}
              >
                <option value="">No seat</option>
                {tree.map((pillar) => (
                  <optgroup key={pillar.id} label={pillar.name}>
                    {pillar.functions.map((fn) => (
                      <option key={fn.id} value={fn.id}>
                        {fn.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
          ))}

          {allFunctions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No functions exist yet, so there is nothing to seat anyone in.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setBlocked(null);
            setDeleteError(null);
            setUsage(null);
          }
        }}
        title={`Delete ${pendingDelete?.name ?? "function"}?`}
        confirmLabel="Delete"
        destructive
        confirmDisabled={blockedByUsage}
        error={blocked ? blocked.message : deleteError}
        onConfirm={handleConfirmDelete}
      >
        <div className="space-y-2 text-sm">
          {usage && (blockedByUsage ? (
            <p>
              This function still has{" "}
              <strong>
                {usage.task_count} {usage.task_count === 1 ? "task" : "tasks"}
              </strong>{" "}
              and{" "}
              <strong>
                {usage.seated_user_count}{" "}
                {usage.seated_user_count === 1 ? "seat" : "seats"}
              </strong>{" "}
              pointing at it. Retag those tasks and move those seats first, or
              rename this function instead of deleting it.
            </p>
          ) : (
            <p>Nothing points at this function. Deleting it is safe.</p>
          ))}
        </div>
      </ConfirmDialog>
    </>
  );
}
