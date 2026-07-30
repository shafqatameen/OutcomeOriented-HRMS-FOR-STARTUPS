"use client";
import { useEffect, useState } from "react";
import { getTasks, completeTask, getUsers, getCategories } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ListTodo, Flame, History } from "lucide-react";

export default function TasksClient() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  const loadTasks = () => {
    getTasks().then(setTasks).catch(console.error);
  };

  useEffect(() => {
    loadTasks();
    getUsers().then(setUsers).catch(console.error);
    getCategories().then(setCategories).catch(console.error);
  }, []);

  const getUserName = (userId: number) => {
    const user = users.find(u => u.id === userId);
    return user ? user.name.toUpperCase() : "Unknown";
  };

  const getTaskPoints = (task: any) => {
    if (task.points !== undefined && task.points !== null) {
      return task.points;
    }
    const cat = categories.find(c => c.id === task.category_id);
    return cat ? cat.default_points : 0;
  };

  const handleComplete = async (taskId: number) => {
    try {
      await completeTask(taskId);
      loadTasks();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Your Tasks</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <ListTodo className="w-5 h-5 text-blue-500" />
            <CardTitle>Daily Habits (Adjacent)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {tasks.filter(t => t.is_recurring && t.status !== "Completed").map(task => (
              <div key={task.id} className="flex justify-between items-center p-3 border rounded">
                <div>
                  <div className="font-semibold">{task.title} <span className="text-slate-400 font-normal text-sm ml-1">({getTaskPoints(task)}p)</span></div>
                  <div className="text-sm text-slate-500">Assigned to: {getUserName(task.user_id)}</div>
                </div>
                <Button onClick={() => handleComplete(task.id)} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Complete
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            <CardTitle>High Impact (Core)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {tasks.filter(t => !t.is_recurring && t.status !== "Completed").map(task => (
              <div key={task.id} className="flex justify-between items-center p-3 border rounded">
                <div>
                  <div className="font-semibold">{task.title} <span className="text-slate-400 font-normal text-sm ml-1">({getTaskPoints(task)}p)</span></div>
                  <div className="text-sm text-slate-500">Assigned to: {getUserName(task.user_id)}</div>
                </div>
                <Button onClick={() => handleComplete(task.id)} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Complete
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <History className="w-5 h-5 text-gray-500" />
          <CardTitle>Task History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tasks.filter(t => t.status === "Completed").length === 0 ? (
            <div className="text-center text-sm text-slate-500 p-4">No completed tasks yet.</div>
          ) : (
            tasks.filter(t => t.status === "Completed").map(task => (
              <div key={task.id} className="flex justify-between items-center p-3 border rounded bg-slate-50/50">
                <div>
                  <div className="font-semibold line-through text-slate-500">{task.title} <span className="font-normal text-sm ml-1">({getTaskPoints(task)}p)</span></div>
                  <div className="text-sm text-slate-400">Completed by: {getUserName(task.user_id)}</div>
                </div>
                <Badge variant="outline" className="text-green-600 bg-green-50">Done</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
