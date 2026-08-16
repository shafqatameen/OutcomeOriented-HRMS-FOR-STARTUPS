"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getUsers,
  createUser,
  updateUser,
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
import { Select } from "@/components/ui/select";
import { PlusCircle, Trash2, UserMinus, UserCheck, Pencil, Check, X, Eye, EyeOff } from "lucide-react";

/**
 * A password box with a reveal toggle.
 *
 * Only ever shows what is being typed right now. The stored password is a hash,
 * so there is no existing one to reveal — an empty box with the eye held open
 * still shows nothing, which is correct rather than broken.
 */
function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="pr-10"
      />
      <button
        // Inside the Add Person <form>, so it must not default to submitting it.
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

type Person = {
  id: number;
  name: string;
  role: string;
  total_points: number;
  is_active: boolean;
  /** Null on accounts predating email sign-in; those still sign in by name. */
  email: string | null;
};

export default function PeopleAdminForm({ currentUserId }: { currentUserId: number }) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

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
      await createUser({ name, role, password, email });
      reloadAll();
      setName("");
      setEmail("");
      setRole("Member");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create person");
    }
  };

  const startEdit = (person: Person) => {
    setEditingId(person.id);
    setEditName(person.name);
    setEditEmail(person.email ?? "");
    // Never prefilled: the stored password is a hash, so there is nothing
    // truthful to show, and a blank box reads correctly as "unchanged".
    setEditPassword("");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditEmail("");
    setEditPassword("");
  };

  const handleSaveEdit = async (userId: number) => {
    setError(null);
    const payload: { name?: string; password?: string; email?: string } = {};
    if (editName.trim()) payload.name = editName.trim();
    // Left blank means keep the current password. The API rejects an empty
    // string rather than hashing it, so it has to be omitted, not sent through.
    if (editPassword) payload.password = editPassword;

    // Only sent when it actually changed. Blanking the box is "leave it alone",
    // not "remove the address" — the API has no way to clear one back to null,
    // because that would hand the account back to name sign-in.
    const trimmedEmail = editEmail.trim();
    if (trimmedEmail && trimmedEmail !== (people.find((p) => p.id === userId)?.email ?? "")) {
      payload.email = trimmedEmail;
    }

    if (!payload.name && !payload.password && !payload.email) {
      cancelEdit();
      return;
    }

    try {
      await updateUser(userId, payload);
      cancelEdit();
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update person");
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="them@example.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <Select
                  className="w-full"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="Member">Member</option>
                  <option value="Admin">Admin</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <PasswordInput value={password} onChange={setPassword} required />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The email address is how this person signs in, so give them one they can actually
              reach. New members start with the default features — widen or narrow that on the
              Access page. An Admin bypasses every permission check.
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
            <div className="text-center text-sm text-muted-foreground p-4">No accounts yet.</div>
          ) : (
            people.map((person) => {
              const isSelf = person.id === currentUserId;
              return (
                <div
                  key={person.id}
                  className="flex justify-between items-center p-3 border rounded gap-4"
                >
                  {editingId === person.id ? (
                    <>
                      <div className="flex flex-1 flex-wrap gap-2 min-w-0">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="max-w-xs"
                          placeholder="Name"
                        />
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="max-w-xs"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder={person.email ? "Email" : "Set an email to enable sign-in"}
                        />
                        <PasswordInput
                          value={editPassword}
                          onChange={setEditPassword}
                          className="w-full max-w-xs"
                          placeholder="Leave blank to keep password"
                        />
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button type="button" size="sm" onClick={() => handleSaveEdit(person.id)}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                  <>
                  <div className="flex flex-col gap-1 min-w-0">
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
                      <span className="text-muted-foreground text-sm">{person.total_points}p</span>
                    </div>
                    {/* An account with no address is not broken — it signs in by
                        name instead. Flagged rather than left blank so it is
                        obvious which accounts still need one. */}
                    {person.email ? (
                      <span className="text-xs text-muted-foreground truncate">{person.email}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No email — signs in with the name “{person.name}”
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(person)}
                      className="flex gap-2"
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </Button>
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
                  </>
                  )}
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
