import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api/client";
import { isDesktop, showWidget } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";

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
  if (!value?.ask) return null;
  return <section role="status" className="cloud-question"><strong>안뇽이 · 너 혹시 딴짓해?</strong><p>{value.ask.title}</p><p>{value.reason} · AI의 추정이에요.</p>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await api.feedback(value.id, value.ask!); if (read()?.id === value.id) write({ ...value, ask: null }); }
      catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}>아니? 전혀~</button><button disabled={busy} onClick={() => write({ ...value, ask: null })}>맞아, 공부로 돌아갈게</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
export default function CloudSession() {
  const value = useCloudSession();
  const { session, ready } = useFocusSession();
  const [task, setTask] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef(new Set<string>());
  const active = useRef<number | null>(null);
  // Relaunch never silently resumes a server session or cloud transmission.
  useEffect(() => { write(null); }, []);
  useEffect(() => {
    if (!value) return;
    if (!session.running || session.task?.id !== TASK_OFFSET + value.id) {
      write(null);
      void api.endSession(value.id).catch(e => setError(`서버 세션 종료를 확인하지 못했어요. ${String(e)}`));
    }
  }, [session.running, session.task?.id, value]);
  useEffect(() => {
    active.current = value?.id ?? null;
    if (!value || !consent || !isDesktop() || !session.running || session.paused) return;
    let cancelled = false;
    let reading = false;
    const id = value.id;
    async function poll() {
      if (reading) return;
      reading = true;
      try {
        const video = await invoke<{ title: string; videoId: string } | null>("browser_video");
        if (!video || cancelled) return;
        const key = `${id}:${video.videoId}`;
        if (seen.current.has(key)) return;
        seen.current.add(key);
        const payload = { title: video.title, video_id: video.videoId };
        const result = await api.judge(id, payload);
        const currentVideo = await invoke<{ videoId: string } | null>("browser_video");
        if (!currentVideo || currentVideo.videoId !== video.videoId) return;
        if (!cancelled && active.current === id && read()?.id === id) {
          if (result.action !== "ask" && result.action !== "ignore") throw new Error("AI 응답 형식을 확인해 주세요.");
          const current = read()!;
          write({ ...current, ask: result.action === "ask" ? payload : null, reason: result.reason });
          setError("");
        }
      } catch (e) { if (!cancelled) setError(`영상 판단 실패 · 이 영상의 자동 재시도는 멈췄어요. ${String(e)}`); }
      finally { reading = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [value?.id, consent, session.running, session.paused]);
  async function start() {
    if (busy || !task.trim()) return;
    setBusy(true); setError("");
    let created: { id: number; task: string } | null = null;
    try {
      created = await api.startSession(task.trim());
      await sessionStore.send({ type: "start", task: { id: TASK_OFFSET + created.id, name: created.task } });
      seen.current.clear();
      write({ ...created, ask: null, reason: "" });
      if (isDesktop()) await showWidget(true);
    } catch (e) {
      if (created && !read()) await api.endSession(created.id).catch(() => {});
      setError(String(e));
    } finally { setBusy(false); }
  }
  return <section className="cloud-session" aria-label="한 줄 집중 세션">
    <h2>지금 뭐 공부하뇽?</h2>
    <form onSubmit={e => { e.preventDefault(); void start(); }}><input aria-label="지금 공부할 일" maxLength={100} value={task} onChange={e => setTask(e.target.value)} placeholder="전자기 유도 공부" disabled={busy || !!value} /><button disabled={busy || !ready || !task.trim() || !!value}>집중 시작</button></form>
    <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> AI 판단에 동의합니다. 작업명과 관측한 영상 제목·ID를 운영 API로 보내며 AI가 제목을 분류합니다.</label>
    <p>{isDesktop() ? "YouTube 연결에서 로컬 관측도 켜 주세요. 안뇽이를 클릭하면 AI 확인 질문을 볼 수 있어요." : "웹에서는 세션 시작·종료와 계획 관리를 제공합니다. 자동 YouTube 관측과 독립 위젯은 Windows 앱 및 Chrome 확장이 필요합니다."}</p>
    {value && <p>집중 중 · {value.task} <button disabled={busy} onClick={async () => { setBusy(true); try { await api.endSession(value.id); write(null); await sessionStore.send({ type: "end" }); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>세션 종료</button></p>}
    <CloudQuestion />{error && <p role="alert">{error}</p>}
    <p><a href="/install.html" target="_blank" rel="noreferrer">Windows·Chrome 설치 안내</a> · <a href="https://github.com/isabel0813/IN-VIBE/releases/download/v0.2.0-incamp-20261114/Mobonyong-Windows-MVP.zip">Windows 시험판 다운로드</a></p>
  </section>;
}
