"use client";
import { useEffect, useState } from "react";
import { getGoals } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ContextHeader from "@/components/ContextHeader";
import { CheckCircle2, Circle } from "lucide-react";

type GoalsClientProps = {
  /** When set, show only this goal. Otherwise show every goal. */
  goalId?: number;
  /** Resolved server-side so the heading is correct on first paint. */
  title?: string;
};

export default function GoalsClient({ goalId, title }: GoalsClientProps) {
  const [goals, setGoals] = useState<any[]>([]);

  useEffect(() => {
    getGoals().then(setGoals).catch(console.error);
  }, []);

  const visibleGoals = goalId === undefined ? goals : goals.filter(g => g.id === goalId);

  return (
    <div className="space-y-6">
      <ContextHeader
        title={title ?? "All Goals"}
        meta={goalId === undefined && goals.length > 0 ? `${goals.length} goals` : undefined}
      />

      {visibleGoals.length === 0 ? (
        <Card>
          <CardContent className="text-center text-sm text-slate-500 p-4">No goals yet.</CardContent>
        </Card>
      ) : (
        visibleGoals.map(goal => (
          <Card key={goal.id}>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>{goal.title}</CardTitle>
              <Badge
                variant="outline"
                className={goal.progress_pct === 100 ? "text-green-600 bg-green-50" : undefined}
              >
                {goal.completed_milestone_count}/{goal.milestone_count} milestones
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${goal.progress_pct}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{goal.progress_pct}% complete</div>

              <div className="mt-4 space-y-3 pl-3 border-l-2 border-slate-200 dark:border-slate-800">
                {goal.milestones.map((milestone: any) => (
                  <div key={milestone.id}>
                    <div className="flex justify-between items-center p-3 border rounded">
                      <div className="flex items-center gap-2">
                        {milestone.progress_pct === 100 ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-400" />
                        )}
                        <span className="font-medium">{milestone.title}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={milestone.progress_pct === 100 ? "text-green-600 bg-green-50" : undefined}
                      >
                        {milestone.task_count === 0 && milestone.progress_pct !== 100
                          ? "No tasks yet"
                          : milestone.progress_pct === 100
                            ? "Completed"
                            : `${milestone.completed_task_count}/${milestone.task_count} tasks`}
                      </Badge>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full ${milestone.progress_pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
                        style={{ width: `${milestone.progress_pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
