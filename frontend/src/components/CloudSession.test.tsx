import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ session: { running: false, paused: false, task: null as null | {id:number;name:string} }, send: vi.fn(), invoke: vi.fn(), show: vi.fn() }));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true, showWidget: mocks.show }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../session/store", () => ({ useFocusSession: () => ({ session: mocks.session, ready: true }), sessionStore: { send: mocks.send } }));
import CloudSession, { CloudQuestion } from "./CloudSession";
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  mocks.session = { running: false, paused: false, task: null };
  mocks.send.mockImplementation(async action => { mocks.session = { running: action.type === "start", paused: false, task: action.task ?? null }; });
  mocks.invoke.mockResolvedValue([{title:"Minecraft gameplay",videoId:"gBGM0l4hulw"}]);
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


it("excludes background music before contacting judge", async () => {
  const fetchMock=transport("ask");
  mocks.invoke.mockResolvedValue([{title:"lofi background music",videoId:"gBGM0l4hulw"}]);
  await start();
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});
it("clears a paused/hidden video's question and reuses its result when visible again", async () => {
  const fetchMock=transport("ask"); await start();
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
  mocks.invoke.mockResolvedValue([]);
  await waitFor(()=>expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull(),{timeout:2200});
  mocks.invoke.mockResolvedValue([{title:"Minecraft gameplay",videoId:"gBGM0l4hulw"}]);
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?",{}, {timeout:2200});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("retains a slow judgment while the video is hidden, without stale intervention or repeated API calls", async () => {
  let finish!: (response: Response)=>void;
  const fetchMock=vi.fn((url:string)=>url.endsWith('/judge')?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(new Response(JSON.stringify({id:7,task:"전자기 유도 공부"}))));
  vi.stubGlobal('fetch',fetchMock); await start();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  mocks.invoke.mockResolvedValue([]);
  finish(new Response(JSON.stringify({action:'ask',reason:'게임 영상'})));
  await waitFor(()=>expect(mocks.invoke.mock.calls.length).toBeGreaterThan(1));
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
  mocks.invoke.mockResolvedValue([{title:"Minecraft gameplay",videoId:"gBGM0l4hulw"}]);
  await screen.findByText("안뇽이 · 너 혹시 딴짓해?",{}, {timeout:2200});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("does not show an ask for an explicit background category", async () => {
  const fetchMock=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/sessions')?{id:7,task:'공부'}:{action:'ask',category:'background',reason:'배경음악'})));
  vi.stubGlobal('fetch',fetchMock); await start();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull();
});
it("retains failed corrections for an explicit retry", async () => {
  let feedbackCalls=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if(url.endsWith('/feedback')) return new Response('{}',{status:++feedbackCalls===1?500:200});
    return new Response(JSON.stringify(url.endsWith('/sessions')?{id:7,task:'공부'}:{action:'ask',reason:'게임'}));
  }));
  await start(); await screen.findByText("안뇽이 · 너 혹시 딴짓해?");
  fireEvent.click(screen.getByRole('button',{name:'아니? 전혀~'}));
  await screen.findByRole('alert');
  expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'아니? 전혀~'}));
  await waitFor(()=>expect(screen.queryByText("안뇽이 · 너 혹시 딴짓해?")).toBeNull());
  expect(feedbackCalls).toBe(2);
});

it("a late feedback response cannot overwrite a different video's question", async () => {
  const key='mobonyong.cloud-session';
  const first={id:7,task:'공부',ask:{title:'first gameplay',video_id:'abcdefghijk'},reason:'게임'};
  const second={...first,ask:{title:'second gameplay',video_id:'zyxwvutsrqp'}};
  let finish!: (response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  localStorage.setItem(key,JSON.stringify(first)); render(<CloudQuestion />);
  fireEvent.click(screen.getByRole('button',{name:'아니? 전혀~'}));
  localStorage.setItem(key,JSON.stringify(second)); fireEvent(window,new Event(key));
  await screen.findByText('second gameplay');
  finish(new Response('{}'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'아니? 전혀~'}) as HTMLButtonElement).disabled).toBe(false));
  expect(JSON.parse(localStorage.getItem(key)!).ask.video_id).toBe('zyxwvutsrqp');
  expect(JSON.parse(localStorage.getItem(`${key}.dismissed`)!).videos).toContain('abcdefghijk');
});
