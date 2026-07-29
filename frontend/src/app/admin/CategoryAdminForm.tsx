"use client";
import { useEffect, useState } from "react";
import { getCategories, createCategory, updateCategory } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle, Pencil, Check, X } from "lucide-react";

export default function CategoryAdminForm() {
  const [categories, setCategories] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [defaultPoints, setDefaultPoints] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPoints, setEditPoints] = useState("");

  const reload = () => getCategories().then(setCategories).catch(console.error);

  useEffect(() => {
    reload();
  }, []);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCategory({ name, default_points: parseInt(defaultPoints) });
      reload();
      setName("");
      setDefaultPoints("");
    } catch (err) {
      console.error(err);
      alert("Failed to create category");
    }
  };

  const startEdit = (category: any) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditPoints(String(category.default_points));
  };

  const cancelEdit = () => setEditingId(null);

  const handleSaveEdit = async (categoryId: number) => {
    try {
      await updateCategory(categoryId, { name: editName, default_points: parseInt(editPoints) });
      setEditingId(null);
      reload();
    } catch (err) {
      console.error(err);
      alert("Failed to update category");
    }
  };

  return (
    <>
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
            <div className="text-center text-sm text-slate-500 p-4">No categories yet.</div>
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
                      {category.name} <span className="text-slate-400 font-normal">({category.default_points}p)</span>
                    </span>
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(category)} className="flex gap-2">
                      <Pencil className="w-4 h-4" />
                      Edit
                    </Button>
                  </>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
