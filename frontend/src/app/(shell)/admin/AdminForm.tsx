"use client";
import { useEffect, useState } from "react";
import { getCategories, getUsers, createTask, getGoals } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle } from "lucide-react";

export default function AdminForm() {
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [userIds, setUserIds] = useState<number[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [points, setPoints] = useState("");
  const [goals, setGoals] = useState<any[]>([]);
  const [milestoneId, setMilestoneId] = useState("");

  useEffect(() => {
    getUsers().then(setUsers).catch(console.error);
    getCategories().then(setCategories).catch(console.error);
    getGoals().then(setGoals).catch(console.error);
  }, []);

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userIds.length === 0) {
      alert("Please select at least one user.");
      return;
    }
    try {
      await Promise.all(userIds.map(id => createTask({
        title,
        user_id: id,
        category_id: parseInt(categoryId),
        is_recurring: isRecurring,
        points: points ? parseInt(points) : undefined,
        milestone_id: milestoneId ? parseInt(milestoneId) : undefined
      })));
      alert("Task Assigned Successfully!");
      setTitle("");
      setMilestoneId("");
    } catch (err) {
      console.error(err);
      alert("Failed to assign task");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign New Task</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAssignTask} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Task Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Assign To</label>
              <div className="flex flex-wrap gap-4">
                {users.map(u => (
                  <label key={u.id} className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={userIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setUserIds([...userIds, u.id]);
                        } else {
                          setUserIds(userIds.filter(id => id !== u.id));
                        }
                      }}
                    />
                    <span>{u.name.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                className="w-full border rounded p-2 bg-white dark:bg-slate-900"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
              >
                <option value="">Select Category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.default_points}p)</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Milestone (Optional)</label>
              <select
                className="w-full border rounded p-2 bg-white dark:bg-slate-900"
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
              >
                <option value="">No Milestone</option>
                {goals.map(g => (
                  <optgroup label={g.title} key={g.id}>
                    {g.milestones.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.title} ({m.completed_task_count}/{m.task_count})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Custom Points (Optional)</label>
            <Input
              type="number"
              placeholder="Leave blank for category default"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </div>
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium">
              <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
              <span>Is Recurring Daily?</span>
            </label>
          </div>
          <Button type="submit" className="flex gap-2">
            <PlusCircle className="w-4 h-4" />
            Assign Task
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
