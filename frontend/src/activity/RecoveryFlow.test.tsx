import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecoveryFlow from "./RecoveryFlow";
import { activityApi } from "./bridge";
import { api } from "../api/client";
import type { RecoveryPlan } from "../api/types";

const incident = { id: 42, seconds: 305, startedAt: 1000, process: "chrome.exe", title: "private game title", claimed: false };
const result: RecoveryPlan = { wasted_minutes: 5, now_task_changed: false, impacts: [], plan: { now: "2026-11-11T12:00:00+09:00", status: "ok", now_task: null, order: [], free_minutes: null, start_by: null, overdue: [] } };
beforeEach(() => { vi.spyOn(activityApi, "respond").mockResolvedValue({} as never); });
afterEach(() => vi.restoreAllMocks());

describe("measured check-in", () => {
  it("corrects a false positive without sending any HTTP request", async () => {
    const wasted = vi.spyOn(api, "wasted");
    render(<RecoveryFlow incident={incident} paused={false} />);
    expect(screen.getByText(/5분 5초/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "아니, 공부 중이었어" }));
    await waitFor(() => expect(activityApi.respond).toHaveBeenCalledWith(42, "studying"));
    expect(wasted).not.toHaveBeenCalled();
  });
  it("reserves once, uses measured whole minutes, retains the recovered plan after native acknowledgement", async () => {
    const wasted = vi.spyOn(api, "wasted").mockResolvedValue(result);
    const view = render(<RecoveryFlow incident={incident} paused={false} />);
    fireEvent.click(screen.getByRole("button", { name: "맞아, 딴짓했어" }));
    expect((screen.getByLabelText("실제 이탈 시간 (분)") as HTMLInputElement).value).toBe("5");
    const confirm = screen.getByRole("button", { name: "시간 확인하고 계획 복구" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await screen.findByText(/확인한 이탈 5분/);
    expect(wasted).toHaveBeenCalledExactlyOnceWith(5);
    expect(activityApi.respond).toHaveBeenNthCalledWith(1, 42, "claim");
    expect(activityApi.respond).toHaveBeenNthCalledWith(2, 42, "resolved");
    view.rerender(<RecoveryFlow incident={null} paused={false} />);
    expect(screen.getByText(/확인한 이탈 5분/)).toBeTruthy();
  });
  it("accepts a user correction, rejects invalid minutes, and never retries an ambiguous request", async () => {
    const wasted = vi.spyOn(api, "wasted").mockRejectedValue(new Error("timeout"));
    const view = render(<RecoveryFlow incident={incident} paused={false} />);
    fireEvent.click(screen.getByRole("button", { name: "맞아, 딴짓했어" }));
    fireEvent.change(screen.getByLabelText("실제 이탈 시간 (분)"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "시간 확인하고 계획 복구" }));
    expect(wasted).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("실제 이탈 시간 (분)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "시간 확인하고 계획 복구" }));
    await screen.findByText(/중복 기록을 막기 위해/);
    view.rerender(<RecoveryFlow incident={{ ...incident, claimed: true }} paused={false} />);
    expect(screen.queryByRole("button", { name: "시간 확인하고 계획 복구" })).toBeNull();
    expect(wasted).toHaveBeenCalledExactlyOnceWith(3);
    expect(activityApi.respond).not.toHaveBeenCalledWith(42, "resolved");
  });
  it("never treats a simulated state or paused session as measured recovery", () => {
    const wasted = vi.spyOn(api, "wasted");
    const view = render(<RecoveryFlow incident={null} paused={false} />);
    expect(screen.queryByLabelText("활동 확인과 계획 복구")).toBeNull();
    view.rerender(<RecoveryFlow incident={incident} paused />);
    expect((screen.getByRole("button", { name: "맞아, 딴짓했어" }) as HTMLButtonElement).disabled).toBe(true);
    expect(wasted).not.toHaveBeenCalled();
  });
});
