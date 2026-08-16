"use client";
import { useEffect, useState } from "react";
import { getCategories, getUsers, createTask, getGoals, getOrgTree } from "@/lib/api";
import type { OrgPillar } from "@/lib/panel";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  const [tree, setTree] = useState<OrgPillar[]>([]);
  const [functionId, setFunctionId] = useState("");

  useEffect(() => {
    getUsers().then(setUsers).catch(console.error);
    getCategories().then(setCategories).catch(console.error);
    getGoals().then(setGoals).catch(console.error);
    getOrgTree().then(setTree).catch(console.error);
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
        function_id: functionId ? parseInt(functionId) : undefined,
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
          {/* Four fields now that a task carries both axes, so the row splits
              two-up before it goes four-up rather than orphaning one control. */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
              <label className="block text-sm font-medium mb-1">Track</label>
              <Select
                className="w-full"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
              >
                <option value="">Select Track</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.default_points}p)</option>)}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                What this does for you, and what it is worth.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Function (Optional)</label>
              <Select
                className="w-full"
                value={functionId}
                onChange={(e) => setFunctionId(e.target.value)}
              >
                <option value="">Untagged</option>
                {tree.map(pillar => (
                  <optgroup key={pillar.id} label={pillar.name}>
                    {pillar.functions.map(fn => (
                      <option key={fn.id} value={fn.id}>{fn.name}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                What kind of work it is. Untagged still scores — it just lands in
                the panel&apos;s Unassigned bucket.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Milestone (Optional)</label>
              <Select
                className="w-full"
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
              </Select>
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
