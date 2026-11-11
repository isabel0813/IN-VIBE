export interface TaskDraft {
  name: string;
  deadline: string;
  important: boolean;
  estimated_minutes: number;
}

export interface Task extends TaskDraft {
  id: number;
  done: boolean;
  done_at: string | null;
}

export interface ParsedTasks {
  drafts: TaskDraft[];
  assumptions: string[];
}

export interface PlanTask extends TaskDraft {
  task_id: number;
  minutes_until_deadline: number;
  assigned_minutes: number;
  short_minutes: number;
}

export interface Plan {
  now: string;
  status: "ok" | "tight" | "short";
  now_task: PlanTask | null;
  order: PlanTask[];
  free_minutes: number | null;
  start_by: string | null;
  overdue: { task_id: number; name: string; deadline: string }[];
}

export interface Settings {
  daily_minutes: number;
}

export interface RecoveryPlan {
  wasted_minutes: number;
  now_task_changed: boolean;
  impacts: { task_id: number; name: string; lost_minutes?: number; short_minutes?: number; overdue?: boolean }[];
  plan: Plan;
}
