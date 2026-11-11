import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FocusSession, SessionAction } from "../session/model";

export const isDesktop = () => isTauri();
export type MainTarget = "plan" | "input";
export interface WidgetLayout {
  open: boolean;
  petX: number;
  petY: number;
  width: number;
  height: number;
}
export const closedLayout: WidgetLayout = {
  open: false,
  petX: 0,
  petY: 0,
  width: 80,
  height: 80,
};

export const desktopSession = {
  read: () => invoke<FocusSession>("session_read"),
  send: (action: SessionAction) =>
    invoke<FocusSession>("session_action", { action }),
  listen: (callback: (value: FocusSession) => void) =>
    listen<FocusSession>("focus-session", (event) => callback(event.payload)),
};

export async function showWidget(hideMain = false): Promise<void> {
  if (isDesktop()) await invoke("widget_show", { hideMain });
  else
    window.dispatchEvent(
      new CustomEvent("web-widget-visible", { detail: true }),
    );
}

export async function showMain(target: MainTarget): Promise<void> {
  if (isDesktop()) await invoke("main_show", { target });
  else
    window.dispatchEvent(new CustomEvent("main-navigate", { detail: target }));
}

export async function onNavigate(
  callback: (target: MainTarget) => void,
): Promise<() => void> {
  if (isDesktop())
    return listen<MainTarget>("main-navigate", (event) =>
      callback(event.payload),
    );
  const listener = (event: Event) =>
    callback((event as CustomEvent<MainTarget>).detail);
  window.addEventListener("main-navigate", listener);
  return () => window.removeEventListener("main-navigate", listener);
}

export async function concealWidget(minimize: boolean): Promise<void> {
  if (isDesktop()) await invoke("widget_conceal", { minimize });
  else {
    await showMain("plan");
    window.dispatchEvent(
      new CustomEvent("web-widget-visible", { detail: false }),
    );
  }
}

export const nativeWidget = {
  readLayout: () => invoke<WidgetLayout>("widget_read_layout"),
  bubble: (open: boolean) => invoke<WidgetLayout>("widget_bubble", { open }),
  drag: () => invoke<void>("widget_drag"),
  listenLayout: (callback: (layout: WidgetLayout) => void) =>
    listen<WidgetLayout>("widget-layout", (event) => callback(event.payload)),
};
