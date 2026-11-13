import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import BrowserControls from "./BrowserControls";
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("requires activity consent and sends an explicit separate YouTube consent", async () => {
  const state = { consent: false, connected: true, collecting: false, observing: false, error: null };
  vi.mocked(invoke).mockResolvedValue(state);
  const view = render(<BrowserControls activityConsent={false} />);
  await screen.findByText(/YouTube 확장 프로그램 · 연결됨/);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  view.rerender(<BrowserControls activityConsent />);
  vi.mocked(invoke).mockResolvedValue({ ...state, consent: true });
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_configure", { consent: true }));
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
  vi.mocked(invoke).mockResolvedValue(state);
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_configure", { consent: false }));
});
it("reports native errors without claiming a connection", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("pipe unavailable"));
  render(<BrowserControls activityConsent />);
  expect((await screen.findByRole("alert")).textContent).toContain("pipe unavailable");
  expect(screen.getByText(/YouTube 확장 프로그램 · 연결 안 됨/)).toBeTruthy();
});
