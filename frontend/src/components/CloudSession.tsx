import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api/client";
import { isDesktop, showWidget } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import { annyongArt } from "../widget/character";
import Icon from "./Icon";

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
  return (
    <section role="status" className="cloud-question">
      <strong>안뇽이 · 너 혹시 딴짓해?</strong>
      <p className="cloud-question-title">{value.ask.title}</p>
      <p className="cloud-question-reason">{value.reason} · AI의 추정이에요.</p>
      <div className="cloud-question-actions">
        <button disabled={busy} onClick={() => write({ ...value, ask: null })}>맞아, 공부로 돌아갈게</button>
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true); setError("");
            try { await api.feedback(value.id, value.ask!); if (read()?.id === value.id) write({ ...value, ask: null }); }
            catch (e) { setError(String(e)); } finally { setBusy(false); }
          }}
        >
          아니? 전혀~
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

type Props = {
  /** 홈 아래 "내 할 일 정리" 링크. 없으면 링크를 숨긴다. */
  onOpenTasks?: () => void;
  /** 홈 아래 "자세한 계획" 링크. 없으면 링크를 숨긴다. */
  onOpenPlan?: () => void;
};

export default function CloudSession({ onOpenTasks, onOpenPlan }: Props = {}) {
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
      setTask("");
      if (isDesktop()) await showWidget(true);
    } catch (e) {
      if (created && !read()) await api.endSession(created.id).catch(() => {});
      setError(String(e));
    } finally { setBusy(false); }
  }
  async function end() {
    if (!value) return;
    setBusy(true);
    try { await api.endSession(value.id); write(null); await sessionStore.send({ type: "end" }); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const canStart = !busy && ready && !!task.trim() && !value;

  return (
    <section className="home-hero" aria-label="한 줄 집중 세션">
      <div className="hero-character">
        <img src={annyongArt} alt="" />
      </div>
      {value ? (
        <>
          <h1>지금은 이거 하는 중이뇽</h1>
          <div className="hero-active">
            <span className="live-dot" aria-hidden="true" />
            <span>집중 중 · <strong>{value.task}</strong></span>
            <button className="ghost" disabled={busy} onClick={() => void end()}>세션 종료</button>
          </div>
        </>
      ) : (
        <>
          <h1>오늘은 뭘 해야 하뇽?</h1>
          <p className="hero-sub">해야 할 일을 편하게 적어 봐.</p>
          <form className="hero-form" onSubmit={e => { e.preventDefault(); void start(); }}>
            <div className="hero-input">
              <input
                aria-label="지금 공부할 일"
                maxLength={100}
                value={task}
                onChange={e => setTask(e.target.value)}
                placeholder="예: 물리학 상대성이론 10장 공부하기"
                disabled={busy}
              />
              <button type="submit" className="hero-send" aria-label="할 일 보내기" disabled={!canStart}>
                <Icon name="arrow" />
              </button>
            </div>
            <button type="submit" className="hero-start" disabled={!canStart}>
              <Icon name="play" />집중 시작하기
            </button>
          </form>
        </>
      )}
      <CloudQuestion />
      <label className="hero-consent">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>
          영상 제목으로 딴짓을 판단하는 데 동의해요
          <small>할 일과 보고 있는 유튜브 영상 제목만 AI로 보내고, 제목은 저장하지 않아요.</small>
        </span>
      </label>
      {error && <p role="alert" className="hero-error">{error}</p>}
      {!isDesktop() && (
        <p className="hero-note">웹에서는 딴짓 감지가 안 돼요. Windows 앱과 크롬 확장이 필요해요.</p>
      )}
      {(onOpenTasks || onOpenPlan) && (
        <nav className="hero-links" aria-label="할 일 관리">
          {onOpenTasks && <button className="link" onClick={onOpenTasks}>내 할 일 정리</button>}
          {onOpenTasks && onOpenPlan && <span aria-hidden="true">·</span>}
          {onOpenPlan && <button className="link" onClick={onOpenPlan}>자세한 계획</button>}
        </nav>
      )}
    </section>
  );
}
