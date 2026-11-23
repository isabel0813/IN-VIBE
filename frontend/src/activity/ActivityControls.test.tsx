import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ActivityControls from "./ActivityControls";
import { emptyActivity, type Activity } from "./bridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true }));
vi.mock("../session/store", () => ({
  useFocusSession: () => ({ ready: true, session: { running: false, paused: false, task: null } }),
}));

afterEach(() => vi.resetAllMocks());
const localConsent = () => screen.getByRole<HTMLInputElement>("checkbox", { name: /로컬 활동 감지에 동의/ });

it.each([false, true])("loads native consent %s after startup without configuring or starting detection", async consent => {
  let finish!: (next: Activity) => void;
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(invoke).mockImplementation(command => command === "activity_read"
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ consent: false }));
  render(<ActivityControls />);
  expect(localConsent().disabled).toBe(true);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("activity_read"));
  await act(async () => finish({ ...emptyActivity, revision: 1, consent }));
  expect(localConsent().checked).toBe(consent);
  expect(localConsent().disabled).toBe(false);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /YouTube 영상 정보의 로컬 관측에 동의/ }).checked).toBe(false);
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).not.toContain("activity_configure");
});

it("does not restore a stale startup snapshot after native revocation", async () => {
  vi.mocked(listen).mockImplementation(async (_event, onEvent) => {
    onEvent({ event: "activity-state", id: 0, payload: { ...emptyActivity, revision: 2 } } as Parameters<typeof onEvent>[0]);
    return () => {};
  });
  vi.mocked(invoke).mockImplementation(async command => command === "activity_read"
    ? { ...emptyActivity, revision: 1, consent: true } : { consent: false });
  render(<ActivityControls />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("activity_read"));
  expect(localConsent().checked).toBe(false);
  expect(localConsent().disabled).toBe(false);
});

it("revokes saved Windows consent immediately when the setting is unchecked", async () => {
  let revokeEvent!: () => void;
  vi.mocked(listen).mockImplementation(async (_event, onEvent) => {
    revokeEvent = () => onEvent({ event: "activity-state", id: 0, payload: { ...emptyActivity, revision: 2 } } as Parameters<typeof onEvent>[0]);
    return () => {};
  });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "activity_read") return { ...emptyActivity, revision: 1, consent: true };
    if (command === "activity_configure") revokeEvent();
    return { consent: false };
  });
  render(<ActivityControls />);
  await waitFor(() => expect(localConsent().checked).toBe(true));
  fireEvent.click(localConsent());
  expect(localConsent().checked).toBe(false);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("activity_configure", {
    config: expect.objectContaining({ consent: false }),
  }));
});
