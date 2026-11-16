import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ session: { running: false, paused: false, task: null as null | {id:number;name:string} }, send: vi.fn(), invoke: vi.fn(), show: vi.fn(), main: vi.fn() }));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true, showWidget: mocks.show, showMain: mocks.main }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../session/store", () => ({ useFocusSession: () => ({ session: mocks.session, ready: true }), sessionStore: { send: mocks.send } }));
import CloudSession, { UltimateOverlay, escalation } from "./CloudSession";

const defaults = { ...escalation };
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  Object.assign(escalation, { firstMs: 0, secondMs: 60 * 60_000, ultimateMs: 2 * 60 * 60_000 });
  mocks.session = { running: false, paused: false, task: null };
  mocks.send.mockImplementation(async action => { mocks.session = { running: action.type === "start", paused: false, task: action.task ?? null }; });
  mocks.invoke.mockResolvedValue({title:"Minecraft gameplay",videoId:"gBGM0l4hulw"});
  mocks.show.mockResolvedValue(undefined);
  mocks.main.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.assign(escalation, defaults); });

const path = (call: unknown[]) => new URL(call[0] as string).pathname;
const apiCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(path).filter(p => p !== "/events");
const events = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
  .filter(c => path(c) === "/events")
  .map(c => JSON.parse((c[1] as RequestInit).body as string) as { type: string; payload: Record<string, unknown> });

function transport(action: "ask" | "ignore", judgeStatus = 200) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/events")) return new Response(null, { status: 204 });
    if (url.endsWith("/judge") && judgeStatus !== 200) return new Response("{}", { status: judgeStatus });
    return new Response(JSON.stringify(url.endsWith("/sessions") ? {id:7,task:"전자기 유도 공부"} : url.endsWith("/judge") ? {action,reason:"게임 영상"} : {}));
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
async function start(consent=true, extra: ReactNode = null) {
  render(<><CloudSession />{extra}</>);
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), {target:{value:"전자기 유도 공부"}});
  if(consent) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"집중 시작하기"}));
  await waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
}

it("starts one-line session, asks from actual observation, sends correction, and ends", async () => {
  const fetchMock=transport("ask"); await start();
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
  fireEvent.click(screen.getByRole("button",{name:"아니? 전혀~"}));
  await waitFor(() => expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"세션 종료"}));
  await waitFor(() => expect(apiCalls(fetchMock)).toEqual(["/sessions","/judge","/judge/feedback","/sessions/7/end"]));
  expect(JSON.parse((fetchMock.mock.calls.find(c => path(c) === "/judge") as unknown as [string,RequestInit])[1].body as string)).toEqual({session_id:7,title:"Minecraft gameplay",video_id:"gBGM0l4hulw"});
  const types = events(fetchMock).map(e => e.type);
  expect(types).toEqual(expect.arrayContaining(["app_open","distraction_detected","intervention_shown","intervention_answered"]));
  expect(events(fetchMock).find(e => e.type === "intervention_answered")?.payload).toMatchObject({answer:"not_distracted"});
  // 이벤트에는 영상 제목이 들어가지 않는다
  expect(JSON.stringify(events(fetchMock))).not.toContain("Minecraft");
});

it("waits until the first threshold before asking", async () => {
  escalation.firstMs = 60 * 60_000;
  const fetchMock=transport("ask"); await start();
  await waitFor(() => expect(apiCalls(fetchMock)).toContain("/judge"));
  await new Promise(r => setTimeout(r, 50));
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});

it("does not ask again about a video after the user answered", async () => {
  const fetchMock=transport("ask"); await start();
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
  fireEvent.click(screen.getByRole("button",{name:"맞아, 공부로 돌아갈게"}));
  await waitFor(() => expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull());
  await new Promise(r => setTimeout(r, 2300)); // 다음 관측 주기
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
  expect(apiCalls(fetchMock).filter(p => p === "/judge")).toHaveLength(1);
}, 8000);

it("shows the scary 안뇽이 when the ultimate threshold has passed without an answer", async () => {
  escalation.secondMs = 0; escalation.ultimateMs = 0;
  const fetchMock=transport("ask"); await start(true, <UltimateOverlay />);
  await screen.findByText("10분째야. 이제 진짜 돌아가자.");
  expect(mocks.main).toHaveBeenCalledWith("plan");
  expect(events(fetchMock).find(e => e.type === "intervention_shown")?.payload).toMatchObject({stage:"ultimate"});
});

it("ignore never shows a confirmation", async () => {
  const fetchMock=transport("ignore"); await start();
  await waitFor(() => expect(apiCalls(fetchMock)).toEqual(["/sessions","/judge"]));
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});

it("keeps quiet when the AI call fails", async () => {
  const fetchMock=transport("ask", 502); await start();
  await waitFor(() => expect(apiCalls(fetchMock)).toContain("/judge"));
  await new Promise(r => setTimeout(r, 50));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});

it("does not send titles without separate AI consent", async () => {
  const fetchMock=transport("ask"); await start(false);
  expect(apiCalls(fetchMock)).toEqual(["/sessions"]); expect(mocks.invoke).not.toHaveBeenCalled();
});
