import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
// These contract tests skip the delay. Production 1/5/10-minute timing is
// exercised with virtual time in Intervention.test.tsx.
vi.mock("./intervention", async original => ({
  ...await original<typeof import("./intervention")>(),
  escalation: { firstMs: 0, secondMs: 300_000, ultimateMs: 600_000 },
}));
const mocks = vi.hoisted(() => ({ session: { running: false, paused: false, task: null as null | {id:number;name:string} }, send: vi.fn(), invoke: vi.fn(), show: vi.fn() }));
vi.mock("../desktop/bridge", () => ({ isDesktop: () => true, showWidget: mocks.show }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string) => command === "browser_read"
  ? Promise.resolve({ consent: true, collecting: true }) : mocks.invoke(command) }));
vi.mock("../session/store", () => ({ useFocusSession: () => ({ session: mocks.session, ready: true }), sessionStore: { send: mocks.send } }));
import CloudSession, { CloudQuestion } from "./CloudSession";
import { cloudMemory } from "./cloudMemory";
beforeEach(() => {
  localStorage.clear(); cloudMemory.reset(); vi.clearAllMocks();
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
  await screen.findByLabelText("YouTube 활동 확인");
  fireEvent.click(screen.getByRole("button",{name:"공부 중인데?"}));
  await waitFor(() => expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"세션 종료"}));
  await waitFor(() => expect(fetchMock.mock.calls.map(c=>new URL(c[0]).pathname)).toEqual(["/sessions","/judge","/judge/feedback","/sessions/7/end"]));
  expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string,RequestInit])[1].body as string)).toEqual({session_id:7,title:"Minecraft gameplay",video_id:"gBGM0l4hulw"});
});
it("ignore never shows a confirmation", async () => {
  const fetchMock=transport("ignore"); await start();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
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
  expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
});
it("clears a paused/hidden video's question and reuses its result when visible again", async () => {
  const fetchMock=transport("ask"); await start();
  await screen.findByLabelText("YouTube 활동 확인");
  mocks.invoke.mockResolvedValue([]);
  await waitFor(()=>expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull(),{timeout:2200});
  mocks.invoke.mockResolvedValue([{title:"Minecraft gameplay",videoId:"gBGM0l4hulw"}]);
  await screen.findByLabelText("YouTube 활동 확인",{}, {timeout:2200});
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
  expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
  mocks.invoke.mockResolvedValue([{title:"Minecraft gameplay",videoId:"gBGM0l4hulw"}]);
  await screen.findByLabelText("YouTube 활동 확인",{}, {timeout:2200});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("does not show an ask for an explicit background category", async () => {
  const fetchMock=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/sessions')?{id:7,task:'공부'}:{action:'ask',category:'background',reason:'배경음악'})));
  vi.stubGlobal('fetch',fetchMock); await start();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull();
});
it("retains failed corrections for an explicit retry", async () => {
  let feedbackCalls=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if(url.endsWith('/feedback')) return new Response('{}',{status:++feedbackCalls===1?500:200});
    return new Response(JSON.stringify(url.endsWith('/sessions')?{id:7,task:'공부'}:{action:'ask',reason:'게임'}));
  }));
  await start(); await screen.findByLabelText("YouTube 활동 확인");
  fireEvent.click(screen.getByRole('button',{name:'공부 중인데?'}));
  await screen.findByRole('alert');
  expect(screen.queryByLabelText("YouTube 활동 확인")).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'공부 중인데?'}));
  await waitFor(()=>expect(screen.queryByLabelText("YouTube 활동 확인")).toBeNull());
  expect(feedbackCalls).toBe(2);
});

it("a late feedback response cannot overwrite a different video's question", async () => {
  const first={id:7,task:'공부',ask:{title:'first gameplay',video_id:'abcdefghijk'},reason:'게임'};
  const second={...first,ask:{title:'second gameplay',video_id:'zyxwvutsrqp'}};
  let finish!: (response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
  cloudMemory.set(first); render(<CloudQuestion />);
  fireEvent.click(screen.getByRole('button',{name:'공부 중인데?'}));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  cloudMemory.set(second);
  await screen.findByText('second gameplay');
  finish(new Response('{}'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'공부 중인데?'}) as HTMLButtonElement).disabled).toBe(false));
  expect(cloudMemory.read()!.ask!.video_id).toBe('zyxwvutsrqp');
  expect(cloudMemory.dismissed()).toContain('abcdefghijk');
});

it("clears the previous question when native observation fails", async () => {
  transport('ask'); await start();
  await screen.findByLabelText('YouTube 활동 확인');
  mocks.invoke.mockRejectedValue(new Error('IPC disconnected'));
  await screen.findByRole('alert',{}, {timeout:2200});
  expect(screen.queryByLabelText('YouTube 활동 확인')).toBeNull();
});
it("removes session video IDs and cached state after session end", async () => {
  transport('ask'); await start();
  await screen.findByLabelText('YouTube 활동 확인');
  fireEvent.click(screen.getByRole('button',{name:'돌아갈게...'}));
  await waitFor(()=>expect(cloudMemory.dismissed()).not.toHaveLength(0));
  fireEvent.click(screen.getByRole('button',{name:'세션 종료'}));
  await waitFor(()=>expect(localStorage.getItem('mobonyong.cloud-session')).toBeNull());
  expect(cloudMemory.dismissed()).toHaveLength(0);
});
it("stops local observation even when server session termination fails", async () => {
  vi.stubGlobal('fetch',vi.fn(async(url:string)=> {
    if(url.endsWith('/end')) return new Response('{}',{status:500});
    return new Response(JSON.stringify(url.endsWith('/sessions')?{id:7,task:'공부'}:{action:'ignore',reason:'공부'}));
  }));
  await start();
  fireEvent.click(screen.getByRole('button',{name:'세션 종료'}));
  await screen.findByRole('alert');
  expect(mocks.session.running).toBe(false);
  expect(localStorage.getItem('mobonyong.cloud-session')).toBeNull();
});
it("serializes feedback across two question views using the origin lock", async () => {
  let queue=Promise.resolve();
  const requests:string[]=[];
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,callback:()=>Promise<void>)=> {
    requests.push(name);
    const next=queue.then(callback); queue=next.catch(()=>{}); return next;
  }}});
  const fetchMock=vi.fn(async()=>new Response('{}'));
  vi.stubGlobal('fetch',fetchMock);
  cloudMemory.set({id:7,task:'공부',ask:{title:'gameplay',video_id:'abcdefghijk'},reason:'게임'});
  try {
    render(<><CloudQuestion /><CloudQuestion /></>);
    const buttons=screen.getAllByRole('button',{name:'공부 중인데?'});
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    await waitFor(()=>expect(screen.queryAllByRole('button',{name:'공부 중인데?'})).toHaveLength(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  } finally { Reflect.deleteProperty(navigator,'locks'); }
});
