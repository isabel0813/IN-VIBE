import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ session: { running: false, paused: false, task: null as null | {id:number;name:string} }, send: vi.fn(), invoke: vi.fn(), show: vi.fn() }));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true, showWidget: mocks.show }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../session/store", () => ({ useFocusSession: () => ({ session: mocks.session, ready: true }), sessionStore: { send: mocks.send } }));
import CloudSession from "./CloudSession";
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  mocks.session = { running: false, paused: false, task: null };
  mocks.send.mockImplementation(async action => { mocks.session = { running: action.type === "start", paused: false, task: action.task ?? null }; });
  mocks.invoke.mockResolvedValue({title:"Minecraft gameplay",videoId:"gBGM0l4hulw"});
  mocks.show.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function transport(action: "ask" | "ignore") {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/sessions") ? {id:7,task:"전자기 유도 공부"} : url.endsWith("/judge") ? {action,reason:"게임 영상"} : {})));
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
async function start(consent=true) {
  render(<CloudSession />);
  fireEvent.change(screen.getByLabelText("지금 공부할 일"), {target:{value:"전자기 유도 공부"}});
  if(consent) fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"집중 시작"}));
  await waitFor(() => expect(mocks.show).toHaveBeenCalledWith(true));
}
it("starts one-line session, asks from actual observation, sends correction, and ends", async () => {
  const fetchMock=transport("ask"); await start();
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
  fireEvent.click(screen.getByRole("button",{name:"아니? 전혀~"}));
  await waitFor(() => expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"세션 종료"}));
  await waitFor(() => expect(fetchMock.mock.calls.map(c=>new URL(c[0]).pathname)).toEqual(["/sessions","/judge","/judge/feedback","/sessions/7/end"]));
  expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string,RequestInit])[1].body as string)).toEqual({session_id:7,title:"Minecraft gameplay",video_id:"gBGM0l4hulw"});
});
it("ignore never shows a confirmation", async () => {
  const fetchMock=transport("ignore"); await start();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});
it("does not send titles without separate AI consent", async () => {
  const fetchMock=transport("ask"); await start(false);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(mocks.invoke).not.toHaveBeenCalled();
});
