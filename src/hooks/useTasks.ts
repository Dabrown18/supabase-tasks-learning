/**
 * React state for the task list. Calls the service layer (services/tasks.ts)
 * and keeps local state in sync with what the database returned.
 */
import { useCallback, useEffect, useState } from 'react';

import * as tasksService from '@/services/tasks';
import type { Task } from '@/types/database';

const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true); // first load
  const [isRefreshing, setIsRefreshing] = useState(false); // pull-to-refresh
  const [error, setError] = useState<string | null>(null);

  // Initial load. State is only set after the request settles, and ignored
  // if the screen unmounted in the meantime.
  useEffect(() => {
    let active = true;
    tasksService
      .listTasks()
      .then((data) => active && setTasks(data))
      .catch((e) => active && setError(toMessage(e)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  /** Runs a database action, storing any error message. Returns success. */
  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    }
  }, []);

  const refresh = async () => {
    setIsRefreshing(true);
    await run(async () => setTasks(await tasksService.listTasks()));
    setIsRefreshing(false);
  };

  const addTask = (title: string) =>
    run(async () => {
      const created = await tasksService.createTask(title);
      setTasks((prev) => [created, ...prev]);
    });

  const toggleTask = (task: Task) =>
    run(async () => {
      const updated = await tasksService.setTaskCompleted(task.id, !task.completed);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    });

  const removeTask = (id: string) =>
    run(async () => {
      await tasksService.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });

  return {
    tasks,
    isLoading,
    isRefreshing,
    error,
    refresh,
    addTask,
    toggleTask,
    removeTask,
  };
}
