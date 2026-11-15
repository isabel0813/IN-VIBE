import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api/client";
import { isDesktop, showWidget } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import { backgroundVideo, shouldAsk } from "./videoPolicy";
import type { Judgment } from "./videoPolicy";

const KEY = "mobonyong.cloud-session";
const TASK_OFFSET = 1_000_000_000_000;
type Video = { title: string; video_id: string };
type CloudState = { id: number; task: string; ask: Video | null; reason: string };
function read(): CloudState | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function write(value: CloudState | null) {
  if (value) localStorage.setItem(KEY, JSON.stringify(value));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(KEY));
}
function dismiss(value: CloudState) {
  const current = read();
  if (current?.id !== value.id) return;
  const old = JSON.parse(localStorage.getItem(`${KEY}.dismissed`) || "null");
  const videos = old?.id === value.id ? old.videos : [];
  localStorage.setItem(`${KEY}.dismissed`, JSON.stringify({ id: value.id, videos: [...new Set([...videos, value.ask?.video_id])] }));
  if (current.ask?.video_id !== value.ask?.video_id) return;
  write({ ...current, ask: null });
}
export function useCloudSession() {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener("storage", update);
    window.addEventListener(KEY, update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener(KEY, update); };
  }, []);
  return value;
}
export function CloudQuestion() {
  const value = useCloudSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  if (!value?.ask) return null;
  return <section role="status" className="cloud-question"><strong>안뇽이 · 너 혹시 딴짓해?</strong><p>{value.ask.title}</p><p>{value.reason} · AI의 추정이에요.</p>
    <button disabled={busy} onClick={async () => {
      if (lock.current) return;
      lock.current = true; setBusy(true); setError("");
      try { await api.feedback(value.id, value.ask!); dismiss(value); }
      catch (e) { setError(String(e)); } finally { lock.current = false; setBusy(false); }
    }}>아니? 전혀~</button><button disabled={busy} onClick={() => dismiss(value)}>맞아, 공부로 돌아갈게</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
// Exactly one controller lives in the main window. Widget views only subscribe
// with useCloudSession/useFocusSession and never create another server session.
export function useCloudController() {
  const value = useCloudSession();
  const { session, ready } = useFocusSession();
  const [task, setTask] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const judgments = useRef(new Map<string, Judgment | null>());
  const dismissed = useRef(new Set<string>());
  const startLock = useRef(false);
  const active = useRef<number | null>(null);
  // Relaunch never silently resumes a server session or cloud transmission.
  useEffect(() => { write(null); }, []);
  useEffect(() => {
    if (!ready || !value || read()?.id !== value.id) return;
    if (!session.running || session.task?.id !== TASK_OFFSET + value.id) {
      write(null);
      void api.endSession(value.id).catch(e => setError(`서버 세션 종료를 확인하지 못했어요. ${String(e)}`));
    }
  }, [ready, session.running, session.task?.id, value]);
  useEffect(() => {
    active.current = value?.id ?? null;
    if (!value || !consent || !isDesktop() || !session.running || session.paused) {
      if (value?.ask) write({ ...value, ask: null });
      return;
    }
    let cancelled = false;
    let reading = false;
    const id = value.id;
    async function poll() {
      if (reading) return;
      reading = true;
      try {
        const videos = await invoke<{ title: string; videoId: string }[]>("browser_videos");
        if (cancelled || active.current !== id || read()?.id !== id) return;
        const dismissedValue = JSON.parse(localStorage.getItem(`${KEY}.dismissed`) || "null");
        if (dismissedValue?.id === id) for (const video of dismissedValue.videos) dismissed.current.add(video);
        const eligible = videos.filter(video => !backgroundVideo(video.title));
        for (const video of eligible) {
          const key = `${id}:${video.videoId}`;
          if (judgments.current.has(key) || dismissed.current.has(video.videoId)) continue;
          judgments.current.set(key, null);
          // Keep sampling during slow AI requests so hidden/paused videos dismiss
          // immediately. A cached result can be used when a video becomes visible again.
          void api.judge(id, { title: video.title, video_id: video.videoId }).then(result => {
            if (result.action !== "ask" && result.action !== "ignore") throw new Error("AI 응답 형식을 확인해 주세요.");
            judgments.current.set(key, result);
            if (!cancelled) void poll();
          }).catch(e => { if (!cancelled) setError(`영상 판단 실패 · 자동 재시도 중지. ${String(e)}`); });
        }
        const current = read()!;
        const asking = eligible.filter(video => {
          const result = judgments.current.get(`${id}:${video.videoId}`);
          return result && !dismissed.current.has(video.videoId) && shouldAsk({ title: video.title, video_id: video.videoId }, result);
        });
        const next = asking.find(video => video.videoId === current.ask?.video_id) ?? asking[0];
        const ask = next ? { title: next.title, video_id: next.videoId } : null;
        if (current.ask?.video_id !== ask?.video_id) write({ ...current, ask, reason: next ? judgments.current.get(`${id}:${next.videoId}`)!.reason : "" });
      } catch (e) { if (!cancelled) setError(`영상 판단 실패 · 이 영상의 자동 재시도는 멈췄어요. ${String(e)}`); }
      finally { reading = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [value?.id, consent, session.running, session.paused]);
  async function start() {
    if (startLock.current || busy || !ready || value || read() || session.running || !task.trim()) return;
    if (task.trim().length > 100 || /[\r\n]/.test(task)) {
      setError("지금 집중할 일을 100자 이내의 한 줄로 입력해 주세요.");
      return;
    }
    startLock.current = true;
    setBusy(true); setError("");
    let created: { id: number; task: string } | null = null;
    try {
      created = await api.startSession(task.trim());
      await sessionStore.send({ type: "start", task: { id: TASK_OFFSET + created.id, name: created.task } });
      judgments.current.clear(); dismissed.current.clear(); localStorage.removeItem(`${KEY}.dismissed`);
      write({ ...created, ask: null, reason: "" });
      await showWidget(true);
    } catch (e) {
      if (created && !read()) await api.endSession(created.id).catch(() => {});
      setError(String(e));
    } finally { startLock.current = false; setBusy(false); }
  }
  async function end(id: number) {
    if (busy || read()?.id !== id) return;
    setBusy(true); setError("");
    // Stop cloud sampling immediately, even if the server is unavailable.
    write(null);
    const failures: string[] = [];
    try { await sessionStore.send({ type: "end" }); }
    catch (e) { failures.push(`로컬 집중 종료를 확인하지 못했어요. ${String(e)}`); }
    try { await api.endSession(id); }
    catch (e) { failures.push(`서버 세션 종료를 확인하지 못했어요. ${String(e)}`); }
    setError(failures.join(" ")); setBusy(false);
  }
  return { value, session, ready, task, setTask, consent, setConsent, busy, error, start, end };
}

// Retained as a small standalone view for existing integrations/tests. App uses
// the same controller with the C landing layout instead of mounting this view.
export default function CloudSession() {
  const { value, ready, task, setTask, consent, setConsent, busy, error, start, end } = useCloudController();
  return <section className="cloud-session" aria-label="한 줄 집중 세션">
    <h2>지금 뭐 공부하뇽?</h2>
    <form onSubmit={e => { e.preventDefault(); void start(); }}><input aria-label="지금 공부할 일" maxLength={100} value={task} onChange={e => setTask(e.target.value)} placeholder="전자기 유도 공부" disabled={busy || !!value} /><button disabled={busy || !ready || !task.trim() || !!value}>집중 시작</button></form>
    <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> AI 판단에 동의합니다. 작업명과 관측한 영상 제목·ID를 운영 API로 보내며 AI가 제목을 분류합니다.</label>
    <p>{isDesktop() ? "YouTube 연결에서 로컬 관측도 켜 주세요. 안뇽이를 클릭하면 AI 확인 질문을 볼 수 있어요." : "웹에서는 세션 시작·종료와 계획 관리를 제공합니다. 자동 YouTube 관측과 독립 위젯은 Windows 앱 및 Chrome 확장이 필요합니다."}</p>
    {value && <p>집중 중 · {value.task} <button disabled={busy} onClick={() => void end(value.id)}>세션 종료</button></p>}
    <CloudQuestion />{error && <p role="alert">{error}</p>}
    <p><a href="/install.html" target="_blank" rel="noreferrer">Windows·Chrome 설치 안내</a> · <a href="https://github.com/isabel0813/IN-VIBE/releases/download/v0.2.0-incamp-20261114/Mobonyong-Windows-MVP.zip">Windows 시험판 다운로드</a></p>
  </section>;
}
