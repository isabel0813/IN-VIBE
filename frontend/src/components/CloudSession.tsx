import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, sendEvent } from "../api/client";
import { isDesktop, showMain, showWidget } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import { annyongArt, ultimateArt } from "../widget/character";
import Icon from "./Icon";

const KEY = "mobonyong.cloud-session";
const TASK_OFFSET = 1_000_000_000_000;

/**
 * 개입 시점. 모두 "그 영상을 처음 본 순간" 기준이다.
 * 1분: 첫 말풍선 → 5분: 무응답이면 한 번 더 → 10분: 무응답이면 무서운 안뇽이.
 * 테스트에서 시간을 줄일 수 있게 내보낸다.
 */
export const escalation = {
  firstMs: 60_000,
  secondMs: 5 * 60_000,
  ultimateMs: 10 * 60_000,
  /** 답한 뒤 다른 영상으로 다시 잔소리하기까지 쉬는 시간 */
  cooldownMs: 2 * 60_000,
};

type Video = { title: string; video_id: string };
type Stage = 1 | 2 | 3;
type CloudState = {
  id: number;
  task: string;
  /** 지금 화면에 띄운 질문 (없으면 null) */
  ask: Video | null;
  reason: string;
  stage?: Stage;
  /** 마지막으로 답한 영상과 시각. 메인 창과 위젯 창이 localStorage로 공유한다. */
  answered?: { videoId: string; at: number };
};
type Tracker = {
  video: Video;
  firstSeen: number;
  verdict: "pending" | "ask" | "ignore";
  reason: string;
  stage: 0 | Stage;
  done: boolean;
};

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

/** 질문에 답했을 때: 이벤트를 남기고, 이 영상은 더 묻지 않게 표시한다. */
function useAnswer() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function answer(value: CloudState, kind: "yes" | "not_distracted") {
    if (!value.ask) return;
    setBusy(true); setError("");
    try {
      if (kind === "not_distracted") await api.feedback(value.id, value.ask);
      sendEvent("intervention_answered", { answer: kind, stage: value.stage ?? 1 });
      const current = read();
      if (current?.id === value.id)
        write({ ...current, ask: null, stage: undefined, answered: { videoId: value.ask.video_id, at: Date.now() } });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return { busy, error, answer };
}

export function CloudQuestion() {
  const value = useCloudSession();
  const { busy, error, answer } = useAnswer();
  if (!value?.ask) return null;
  return (
    <section role="status" className="cloud-question">
      <strong>안뇽이 · 너 혹시 딴짓해?</strong>
      {value.stage && value.stage >= 2 && <p className="cloud-question-nudge">아직 보고 있뇽? 벌써 5분이 넘었어.</p>}
      <p className="cloud-question-title">{value.ask.title}</p>
      <p className="cloud-question-reason">{value.reason} · AI의 추정이에요.</p>
      <div className="cloud-question-actions">
        <button disabled={busy} onClick={() => void answer(value, "yes")}>맞아, 공부로 돌아갈게</button>
        <button className="ghost" disabled={busy} onClick={() => void answer(value, "not_distracted")}>아니? 전혀~</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** 10분 동안 답이 없으면 화면 전체에 띄우는 무서운 안뇽이. App에서 항상 렌더한다. */
export function UltimateOverlay() {
  const value = useCloudSession();
  const { busy, error, answer } = useAnswer();
  if (!value?.ask || value.stage !== 3) return null;
  return (
    <div className="ultimate-overlay" role="alertdialog" aria-modal="true" aria-label="안뇽이 경고">
      <img src={ultimateArt} alt="" />
      <div className="ultimate-card">
        <strong>10분째야. 이제 진짜 돌아가자.</strong>
        <p>{value.ask.title}</p>
        <div className="cloud-question-actions">
          <button disabled={busy} onClick={() => void answer(value, "yes")}>맞아, 공부로 돌아갈게</button>
          <button className="ghost" disabled={busy} onClick={() => void answer(value, "not_distracted")}>아니? 전혀~</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
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
  const trackers = useRef(new Map<string, Tracker>());
  const cooldownUntil = useRef(0);
  const active = useRef<number | null>(null);
  // Relaunch never silently resumes a server session or cloud transmission.
  useEffect(() => {
    write(null);
    sendEvent("app_open", { platform: isDesktop() ? "desktop" : "web" });
  }, []);
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

    // 답한 영상은 다시 묻지 않고, 답한 직후에는 잠시 쉰다 (반복 잔소리 방지).
    function applyAnswer() {
      const answered = read()?.answered;
      if (!answered) return;
      const t = trackers.current.get(answered.videoId);
      if (t) t.done = true;
      cooldownUntil.current = Math.max(cooldownUntil.current, answered.at + escalation.cooldownMs);
    }

    function escalate(t: Tracker) {
      if (t.verdict !== "ask" || t.done) return;
      const now = Date.now();
      if (now < cooldownUntil.current) return;
      const elapsed = now - t.firstSeen;
      const target: 0 | Stage =
        elapsed >= escalation.ultimateMs ? 3 : elapsed >= escalation.secondMs ? 2 : elapsed >= escalation.firstMs ? 1 : 0;
      if (target <= t.stage) return;
      if (t.stage >= 1) sendEvent("intervention_answered", { answer: "none", stage: t.stage });
      t.stage = target;
      const current = read();
      if (!current || current.id !== id) return;
      write({ ...current, ask: t.video, reason: t.reason, stage: target });
      sendEvent("intervention_shown", {
        stage: target === 3 ? "ultimate" : "bubble",
        variant: target === 1 ? "first" : target === 2 ? "second" : "ultimate",
      });
      if (target === 3) void showMain("plan").catch(() => {});
    }

    async function poll() {
      if (reading) return;
      reading = true;
      try {
        applyAnswer();
        const video = await invoke<{ title: string; videoId: string } | null>("browser_video");
        if (!video || cancelled) return;
        let t = trackers.current.get(video.videoId);
        if (!t) {
          // 처음 본 영상: 시각을 기록하고 한 번만 AI에 묻는다.
          t = { video: { title: video.title, video_id: video.videoId }, firstSeen: Date.now(), verdict: "pending", reason: "", stage: 0, done: false };
          trackers.current.set(video.videoId, t);
          try {
            const result = await api.judge(id, t.video);
            if (result.action !== "ask" && result.action !== "ignore") throw new Error("AI 응답 형식을 확인해 주세요.");
            t.verdict = result.action;
            t.reason = result.reason;
            if (result.action === "ask") sendEvent("distraction_detected", { site: "youtube" });
          } catch (e) {
            // API 오류는 사용자에게 경고하지 않고, 이 영상은 판단 불가로 둔다.
            t.verdict = "ignore";
            console.warn("영상 판단 실패", e);
            return;
          }
          // 판단하는 사이 다른 영상으로 넘어갔으면 이번엔 개입하지 않는다.
          const currentVideo = await invoke<{ videoId: string } | null>("browser_video");
          if (!currentVideo || currentVideo.videoId !== video.videoId) return;
        }
        if (!cancelled && active.current === id) escalate(t);
      } catch (e) {
        if (!cancelled) console.warn("영상 관측 실패", e);
      } finally { reading = false; }
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
      trackers.current.clear();
      cooldownUntil.current = 0;
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
