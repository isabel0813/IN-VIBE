import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => mocks);
import {
  concealWidget,
  showMain,
  showWidget,
  nativeWidget,
  desktopSession,
} from "./bridge";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockClear();
});
describe("native window bridge", () => {
  it("invokes real Tauri commands, keeping native behavior separate from preview", async () => {
    await desktopSession.send({ type: "start", task: { id: 8, name: "과제" } });
    await showWidget(true);
    await nativeWidget.bubble(true);
    await nativeWidget.drag();
    await showMain("input");
    await concealWidget(true);
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual([
      "session_action",
      "widget_show",
      "widget_bubble",
      "widget_drag",
      "main_show",
      "widget_conceal",
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("widget_show", {
      hideMain: true,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("main_show", { target: "input" });
  });
  it("does not invoke OS window controls in web mode", async () => {
    mocks.isTauri.mockReturnValue(false);
    await showWidget(true);
    await showMain("plan");
    await concealWidget(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
