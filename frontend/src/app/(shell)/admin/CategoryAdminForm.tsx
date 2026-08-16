"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getCategories,
  createCategory,
  updateCategory,
  getCategoryUsage,
  deleteCategory,
  asDeletionBlocked,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Select } from "@/components/ui/select";
import { PlusCircle, Pencil, Check, X, Trash2 } from "lucide-react";

type Category = { id: number; name: string; default_points: number };
type CategoryUsage = {
  category_id: number;
  name: string;
  task_count: number;
  completed_task_count: number;
  pending_task_count: number;
};

export default function CategoryAdminForm() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [defaultPoints, setDefaultPoints] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPoints, setEditPoints] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** The category queued for deletion, plus what deleting it would disturb. */
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [usage, setUsage] = useState<CategoryUsage | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = () => getCategories().then(setCategories).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  /**
   * The rail's category sub-items are rendered by a Server Component in the
   * shell layout, so a mutation here has to invalidate that too — otherwise a
   * category lingers in the rail, or a new one is missing from it, until a hard
   * reload.
   */
  const reloadAll = () => {
    reload();
    router.refresh();
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createCategory({ name, default_points: parseInt(defaultPoints) });
      reloadAll();
      setName("");
      setDefaultPoints("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    }
  };

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditPoints(String(category.default_points));
  };

  const cancelEdit = () => setEditingId(null);

  const handleSaveEdit = async (categoryId: number) => {
    setError(null);
    try {
      await updateCategory(categoryId, { name: editName, default_points: parseInt(editPoints) });
      setEditingId(null);
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    }
  };

  const startDelete = async (category: Category) => {
    setPendingDelete(category);
    setUsage(null);
    setReassignTo("");
    setDeleteError(null);
    try {
      setUsage(await getCategoryUsage(category.id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not check what uses this category");
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteCategory(pendingDelete.id, reassignTo ? parseInt(reassignTo) : undefined);
      setPendingDelete(null);
      reloadAll();
    } catch (err) {
      // A task may have been assigned between the usage check and the confirm,
      // so re-read the counts rather than leaving a stale picker on screen.
      const blocked = asDeletionBlocked(err);
      setDeleteError(err instanceof Error ? err.message : "Failed to delete category");
      if (blocked) getCategoryUsage(pendingDelete.id).then(setUsage).catch(() => {});
    }
  };

  // Anywhere the tasks could go instead. Deleting the last category in use is
  // therefore impossible, which is correct: those tasks need a home.
  const reassignOptions = categories.filter((c) => c.id !== pendingDelete?.id);
  const needsReassign = (usage?.task_count ?? 0) > 0;
  const noRoomToReassign = needsReassign && reassignOptions.length === 0;

  return (
    <>
      {error && (
        <div className="rounded border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create Category</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateCategory} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Points</label>
                <Input
                  type="number"
                  value={defaultPoints}
                  onChange={(e) => setDefaultPoints(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Create Category
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {categories.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground p-4">No categories yet.</div>
          ) : (
            categories.map((category) => (
              <div key={category.id} className="flex justify-between items-center p-3 border rounded gap-4">
                {editingId === category.id ? (
                  <>
                    <div className="flex flex-1 gap-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-xs" />
                      <Input
                        type="number"
                        value={editPoints}
                        onChange={(e) => setEditPoints(e.target.value)}
                        className="max-w-[100px]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => handleSaveEdit(category.id)}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="font-medium">
                      {category.name} <span className="text-muted-foreground font-normal">({category.default_points}p)</span>
                    </span>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => startEdit(category)} className="flex gap-2">
                        <Pencil className="w-4 h-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => startDelete(category)}
                        className="flex gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? "category"}?`}
        description="This cannot be undone."
        confirmLabel="Delete category"
        destructive
        confirmDisabled={!usage || noRoomToReassign || (needsReassign && !reassignTo)}
        error={deleteError}
        onConfirm={handleConfirmDelete}
      >
        {!usage ? (
          <div className="text-sm text-muted-foreground">Checking what uses this category…</div>
        ) : usage.task_count === 0 ? (
          <div className="text-sm text-muted-foreground">No tasks use this category.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border bg-muted/40 p-3 text-sm">
              <span className="font-medium">
                {usage.task_count} {usage.task_count === 1 ? "task uses" : "tasks use"} this category
              </span>{" "}
              <span className="text-muted-foreground">
                ({usage.completed_task_count} completed, {usage.pending_task_count} pending). They must
                move somewhere before it can go.
              </span>
            </div>

            {noRoomToReassign ? (
              <div className="text-sm text-destructive">
                There is nowhere to move them. Create another category first.
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Move these tasks to</label>
                <Select
                  className="w-full"
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                >
                  <option value="">Select category</option>
                  {reassignOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.default_points}p)
                    </option>
                  ))}
                </Select>
                <p className="mt-2 text-xs text-muted-foreground">
                  Tasks without a custom point value will be worth the destination&apos;s default.
                  {usage.completed_task_count > 0 &&
                    " Points already earned by completed tasks move with them on the leaderboard."}
                </p>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
