import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlanView from "./PlanView";
import type { Plan, Task } from "../api/types";

describe("plan edge cases", () => {
  const tasks: Task[] = [
    {
      id: 1,
      name: "지난 과제",
      deadline: "2026-11-10T12:00:00+09:00",
      estimated_minutes: 60,
      important: false,
      done: false,
      done_at: null,
    },
    {
      id: 2,
      name: "발표",
      deadline: "2026-11-12T12:00:00+09:00",
      estimated_minutes: 120,
      important: true,
      done: false,
      done_at: null,
    },
  ];
  const item = {
    ...tasks[1],
    task_id: 2,
    minutes_until_deadline: 40,
    assigned_minutes: 40,
    short_minutes: 80,
  };
  const plan: Plan = {
    now: "2026-11-12T11:20:00+09:00",
    status: "short",
    now_task: item,
    order: [item],
    free_minutes: 0,
    start_by: null,
    overdue: [{ task_id: 1, name: tasks[0].name, deadline: tasks[0].deadline }],
  };
  const props = {
    tasks,
    plan,
    settings: { daily_minutes: 480 },
    busy: false,
    activeId: null,
    onStart: vi.fn(),
    onDone: vi.fn(),
    onEdit: vi.fn(),
    onAdd: vi.fn(),
  };

  it("shows server shortage and overdue separately and starts the server-selected task", () => {
    render(<PlanView {...props} />);
    expect(screen.getByText("1시간 20분")).toBeTruthy();
    expect(screen.getByText(/1시간 20분 부족/)).toBeTruthy();
    expect(screen.getByText("마감 지남")).toBeTruthy();
    expect(screen.getByText(/위 여유·부족 시간 계산에서 제외/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "작업 시작" }));
    expect(props.onStart).toHaveBeenCalledWith(2);
  });
  it("offers deadline correction when every remaining task is overdue", () => {
    render(
      <PlanView
        {...props}
        tasks={[tasks[0]]}
        plan={{
          ...plan,
          now_task: null,
          order: [],
          free_minutes: null,
          status: "ok",
        }}
      />,
    );
    expect(screen.getByText("마감이 지난 작업을 확인해 주세요.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "작업 시작" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "지난 과제 수정" }));
    expect(props.onEdit).toHaveBeenCalledWith(tasks[0]);
  });
});
