"use client";
import { useEffect, useState } from "react";
import { getGoals, createGoal, createMilestone, completeMilestone } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PlusCircle } from "lucide-react";

export default function GoalsAdminForm() {
  const [goals, setGoals] = useState<any[]>([]);
  const [goalTitle, setGoalTitle] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState("");

  const reload = () => getGoals().then(setGoals).catch(console.error);

  useEffect(() => {
    reload();
  }, []);

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createGoal({ title: goalTitle });
      reload();
      setGoalTitle("");
    } catch (err) {
      console.error(err);
      alert("Failed to create goal");
    }
  };

  const handleAddMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoalId) {
      alert("Please select a goal.");
      return;
    }
    try {
      await createMilestone({ title: milestoneTitle, goal_id: parseInt(selectedGoalId) });
      reload();
      setMilestoneTitle("");
    } catch (err) {
      console.error(err);
      alert("Failed to add milestone");
    }
  };

  const handleCompleteMilestone = async (milestoneId: number) => {
    try {
      await completeMilestone(milestoneId);
      reload();
    } catch (err) {
      console.error(err);
      alert("Failed to update milestone");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Create Goal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateGoal} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Goal Title</label>
              <Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} required />
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Create Goal
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create Milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddMilestone} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Milestone Title</label>
              <Input value={milestoneTitle} onChange={(e) => setMilestoneTitle(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Goal</label>
              <select
                className="w-full border rounded p-2 bg-white dark:bg-slate-900"
                value={selectedGoalId}
                onChange={(e) => setSelectedGoalId(e.target.value)}
              >
                <option value="">Select Goal</option>
                {goals.map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
            <Button type="submit" className="flex gap-2">
              <PlusCircle className="w-4 h-4" />
              Add Milestone
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Goals & Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {goals.length === 0 ? (
            <div className="text-center text-sm text-slate-500 p-4">No goals yet.</div>
          ) : (
            goals.map(goal => (
              <div key={goal.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{goal.title}</span>
                  <Badge variant="outline">{goal.completed_milestone_count}/{goal.milestone_count} milestones</Badge>
                </div>
                <div className="space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-800">
                  {goal.milestones.map((milestone: any) => (
                    <div key={milestone.id} className="flex justify-between items-center p-3 border rounded">
                      <span className="font-medium">{milestone.title}</span>
                      <div className="flex items-center gap-2">
                        {milestone.progress_pct === 100 ? (
                          <Badge variant="outline" className="text-green-600 bg-green-50">Completed</Badge>
                        ) : (
                          <>
                            <Badge variant="outline">{milestone.completed_task_count}/{milestone.task_count} tasks</Badge>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleCompleteMilestone(milestone.id)}
                            >
                              Mark Complete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
