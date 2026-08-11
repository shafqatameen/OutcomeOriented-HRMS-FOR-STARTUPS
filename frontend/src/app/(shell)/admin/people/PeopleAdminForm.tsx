"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUsers,
  createUser,
  setUserActive,
  deleteUser,
  asDeletionBlocked,
  type DeletionBlocked,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PlusCircle, Trash2, UserMinus, UserCheck } from "lucide-react";

type Person = {
  id: number;
  name: string;
  role: string;
  total_points: number;
  is_active: boolean;
};

export default function PeopleAdminForm({ currentUserId }: { currentUserId: number }) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("Member");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Person | null>(null);
  const [blocked, setBlocked] = useState<DeletionBlocked | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [pendingDeactivate, setPendingDeactivate] = useState<Person | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const reload = () => getUsers().then(setPeople).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  /**
   * The rail and the Access page both read the account list, so a mutation here
   * has to invalidate the Server Components too — otherwise a deleted person
   * lingers elsewhere in the shell until a hard reload.
   */
  const reloadAll = () => {
    reload();
    router.refresh();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createUser({ name, role, password });
      reloadAll();
      setName("");
      setRole("Member");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create person");
    }
  };

  const handleRestore = async (person: Person) => {
    setError(null);
    try {
      await setUserActive(person.id, true);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore account");
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!pendingDeactivate) return;
    setDeactivateError(null);
    try {
      await setUserActive(pendingDeactivate.id, false);
      setPendingDeactivate(null);
      reloadAll();
    } catch (err) {
      setDeactivateError(err instanceof Error ? err.message : "Failed to deactivate account");
    }
  };

  const startDelete = (person: Person) => {
    setPendingDelete(person);
    setBlocked(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteUser(pendingDelete.id);
      setPendingDelete(null);
      reloadAll();
    } catch (err) {
      // A refusal is the expected answer for anyone with history, so the
      // blast radius the API sent back is rendered rather than just its message.
      setBlocked(asDeletionBlocked(err));
      setDeleteError(err instanceof Error ? err.message : "Failed to delete person");
    }
  };

  // Points are already on screen, so an account that certainly cannot be deleted
  // can say so before the request rather than after it. A zero here is not a
  // promise: pending tasks also block, and only the API knows about those.
  const certainlyBlocked = (pendingDelete?.total_points ?? 0) > 0;

  return (
    <>
      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add Person</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  className="w-full border rounded p-2 bg-white dark:bg-slate-900"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="Member">Member</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              New members start with the default features. Widen or narrow that on the Access page.
              An Admin bypasses every permission check.
            </p>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Add Person
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Everyone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {people.length === 0 ? (
            <div className="text-center text-sm text-slate-500 p-4">No accounts yet.</div>
          ) : (
            people.map((person) => {
              const isSelf = person.id === currentUserId;
              return (
                <div
                  key={person.id}
                  className="flex justify-between items-center p-3 border rounded gap-4"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{person.name}</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {person.role}
                    </Badge>
                    {!person.is_active && (
                      <Badge variant="outline" className="text-destructive">
                        Deactivated
                      </Badge>
                    )}
                    {isSelf && (
                      <span className="text-xs text-muted-foreground">(you)</span>
                    )}
                    <span className="text-slate-400 text-sm">{person.total_points}p</span>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    {person.is_active ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSelf}
                        title={isSelf ? "You cannot deactivate your own account" : undefined}
                        onClick={() => {
                          setPendingDeactivate(person);
                          setDeactivateError(null);
                        }}
                        className="flex gap-2"
                      >
                        <UserMinus className="w-4 h-4" />
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(person)}
                        className="flex gap-2"
                      >
                        <UserCheck className="w-4 h-4" />
                        Restore
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isSelf}
                      title={isSelf ? "You cannot delete your own account" : undefined}
                      onClick={() => startDelete(person)}
                      className="flex gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => !open && setPendingDeactivate(null)}
        title={`Deactivate ${pendingDeactivate?.name ?? "account"}?`}
        confirmLabel="Deactivate"
        error={deactivateError}
        onConfirm={handleConfirmDeactivate}
      >
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            They will be signed out on their next request and cannot sign back in until an
            administrator restores them.
          </p>
          <p>
            Their tasks, their points and their place on the leaderboard are all kept exactly as
            they are. Restoring undoes this in one click.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? "person"}?`}
        description="This cannot be undone."
        confirmLabel="Delete person"
        destructive
        error={blocked ? null : deleteError}
        onConfirm={handleConfirmDelete}
      >
        {blocked ? (
          <div className="space-y-3">
            <div className="rounded border border-destructive/50 p-3 text-sm">
              <span className="font-medium text-destructive">Cannot be deleted.</span>{" "}
              <span className="text-muted-foreground">
                {blocked.name} is still referenced by{" "}
                {blocked.blockers
                  .map((b) => `${b.count} ${b.kind}${b.detail ? ` (${b.detail})` : ""}`)
                  .join(" and ")}
                .
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{blocked.remedy}</p>
          </div>
        ) : certainlyBlocked ? (
          <div className="rounded border bg-muted/40 p-3 text-sm text-muted-foreground">
            {pendingDelete?.name} has earned {pendingDelete?.total_points} points. Deleting would
            orphan that history, so the API will refuse — deactivate the account instead to block
            sign-in and keep the record.
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Only an account with no tasks and no points can be removed. If anything still refers to
            this one, the delete is refused and nothing changes.
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
