import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../api/client";
import { isDesktop, showWidget } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import { backgroundVideo, shouldAsk } from "./videoPolicy";
import type { Judgment } from "./videoPolicy";
import { escalation, InterventionClock } from "./intervention";
import { ultimateArt } from "../widget/character";

import { cloudMemory, removeLegacyCloudData } from "./cloudMemory";
import type { CloudState } from "./cloudMemory";
const TASK_OFFSET = 1_000_000_000_000;
function read(): CloudState | null { return cloudMemory.read(); }
function write(value: CloudState | null) { cloudMemory.set(value); }
function dismiss(value: CloudState) {
  return value.ask ? cloudMemory.dismiss(value.id, value.ask.video_id) : Promise.resolve();
}
async function correct(value: CloudState) {
  const send = async () => {
    await cloudMemory.refresh();
    const current = read();
    // Recheck after acquiring the shared lock. Another view may have already
    // corrected this video, ended the session, or replaced the question.
    if (current?.id !== value.id || current.ask?.video_id !== value.ask?.video_id) return;
    if (isDesktop()) {
      const native = await invoke<{ consent: boolean; collecting: boolean }>("browser_read");
      if (!native.consent || !native.collecting) return;
    }
    if (read()?.ask?.video_id !== value.ask?.video_id || read()?.id !== value.id) return;
    await api.feedback(value.id, value.ask!);
    await dismiss(value);
  };
  if (navigator.locks) {
    await navigator.locks.request(`mobonyong.feedback.${value.id}.${value.ask?.video_id}`, send);
  } else {
    // Older webviews retain the component-local lock; cross-window exclusion
    // requires a secure-context Web Locks implementation.
    await send();
  }
}
export function useCloudSession() {
  const [value, setValue] = useState(read);
  useEffect(() => {
    return cloudMemory.subscribe(() => setValue(read()));
  }, []);
  return value;
}
function useQuestionResponse() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function answer(value: CloudState, correction: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { if (correction) await correct(value); else await dismiss(value); }
    catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, answer };
}
function QuestionActions({ value }: { value: CloudState }) {
  const { busy, error, answer } = useQuestionResponse();
  return <>
    <div className="cloud-question-actions">
      <button disabled={busy} onClick={() => void answer(value, false)}>맞아, 공부로 돌아갈게</button>
      <button className="ghost" disabled={busy} onClick={() => void answer(value, true)}>아니? 전혀~</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </>;
}
export function CloudQuestion() {
  const value = useCloudSession();
  if (!value?.ask) return null;
  return <section role="status" className="cloud-question"><strong>안뇽이 · 너 혹시 딴짓해?</strong>
    {value.stage && value.stage >= 2 && <p className="cloud-question-nudge">아직 보고 있뇽? 벌써 5분이 넘었어.</p>}
    <p className="cloud-question-title">{value.ask.title}</p><p className="cloud-question-reason">{value.reason} · AI의 추정이에요.</p>
    <QuestionActions value={value} />
  </section>;
}
export function UltimateOverlay({ onEnd }: { onEnd?: () => void } = {}) {
  const value = useCloudSession();
  const dialog = useRef<HTMLDivElement>(null);
  const open = !!value?.ask && value.stage === 3;
  useEffect(() => { if (open) dialog.current?.focus(); }, [open]);
  if (!open || !value) return null;
  return <div className="ultimate-overlay" ref={dialog} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label="안뇽이 궁극기"
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    }}>
    <img src={ultimateArt} alt="안뇽이 궁극기" />
    <div className="ultimate-card"><strong>10분째야. 이제 진짜 돌아가자.</strong>
      <p>{value.ask?.title}</p><p>{value.reason} · AI의 추정이에요.</p><QuestionActions value={value} />
      {onEnd && <button className="text-button" onClick={onEnd}>집중 세션 종료</button>}
    </div>
  </div>;
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
  const observationEpoch = useRef(0);
  const clock = useRef(new InterventionClock(escalation));
  // Relaunch never silently resumes a server session or cloud transmission.
  useEffect(() => {
    if (!removeLegacyCloudData()) setError("이전 영상 저장 정보를 지우지 못했어요. 로컬 저장소 접근을 확인해 주세요.");
    cloudMemory.reset();
    return () => cloudMemory.reset();
  }, []);
  useEffect(() => {
    if (!ready || !value || read()?.id !== value.id) return;
    if (!session.running || session.task?.id !== TASK_OFFSET + value.id) {
      write(null);
      void api.endSession(value.id).catch(e => setError(`서버 세션 종료를 확인하지 못했어요. ${String(e)}`));
    }
  }, [ready, session.running, session.task?.id, value]);
  useEffect(() => {
    active.current = value?.id ?? null;
    if (!value || !consent) { observationEpoch.current++; judgments.current.clear(); dismissed.current.clear(); clock.current.clear(); }
    if (!value || !consent || !isDesktop() || !session.running || session.paused) {
      clock.current.pause();
      if (value?.ask || value?.reason || value?.stage) write({ ...value, ask: null, reason: "", stage: undefined });
      return;
    }
    let cancelled = false;
    let reading = false;
    const id = value.id;
    async function poll() {
      if (reading) return;
      reading = true;
      try {
        const native = await invoke<{ consent: boolean; collecting: boolean }>("browser_read");
        if (cancelled || active.current !== id || read()?.id !== id) return;
        if (!native.consent || !native.collecting) {
          observationEpoch.current++;
          judgments.current.clear(); dismissed.current.clear();
          clock.current.clear();
          const current = read();
          if (current?.ask || current?.reason || current?.stage) write({ ...current, ask: null, reason: "", stage: undefined });
          return;
        }
        const videos = await invoke<{ title: string; videoId: string }[]>("browser_videos");
        if (cancelled || active.current !== id || read()?.id !== id) return;
        for (const video of cloudMemory.dismissed()) dismissed.current.add(video);
        const eligible = videos.filter(video => !backgroundVideo(video.title));
        clock.current.observe(eligible.filter(video => !dismissed.current.has(video.videoId)).map(video => video.videoId), Date.now());
        for (const video of eligible) {
          const key = `${id}:${video.videoId}`;
          if (judgments.current.has(key) || dismissed.current.has(video.videoId)) continue;
          judgments.current.set(key, null);
          const epoch = observationEpoch.current;
          // Keep sampling during slow AI requests so hidden/paused videos dismiss
          // immediately. A cached result can be used when a video becomes visible again.
          void api.judge(id, { title: video.title, video_id: video.videoId }).then(result => {
            if (cancelled || active.current !== id || observationEpoch.current !== epoch) return;
            if (result.action !== "ask" && result.action !== "ignore") throw new Error("AI 응답 형식을 확인해 주세요.");
            judgments.current.set(key, result);
            if (!cancelled) void poll();
          }).catch(e => { if (!cancelled) setError(`영상 판단 실패 · 자동 재시도 중지. ${String(e)}`); });
        }
        const current = read()!;
        const asking = eligible.filter(video => {
          const result = judgments.current.get(`${id}:${video.videoId}`);
          return result && clock.current.stage(video.videoId) > 0 && !dismissed.current.has(video.videoId) && shouldAsk({ title: video.title, video_id: video.videoId }, result);
        });
        asking.sort((a, b) => clock.current.stage(b.videoId) - clock.current.stage(a.videoId));
        const highest = asking[0] ? clock.current.stage(asking[0].videoId) : 0;
        const next = asking.find(video => video.videoId === current.ask?.video_id && clock.current.stage(video.videoId) === highest) ?? asking[0];
        const ask = next ? { title: next.title, video_id: next.videoId } : null;
        const stage = next ? clock.current.stage(next.videoId) || undefined : undefined;
        if (current.ask?.video_id !== ask?.video_id || current.stage !== stage) write({ ...current, ask, stage, reason: next ? judgments.current.get(`${id}:${next.videoId}`)!.reason : "" });
      } catch (e) {
        clock.current.pause();
        if (!cancelled) {
          const current = read();
          if (current?.id === id && current.ask) write({ ...current, ask: null, reason: "", stage: undefined });
          setError(`영상 관측을 확인하지 못했어요. ${String(e)}`);
        }
      }
      finally { reading = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { cancelled = true; clearInterval(timer); clock.current.pause(); };
  }, [value?.id, consent, session.running, session.paused]);
  useEffect(() => {
    if (!isDesktop() || !consent || !session.running || session.paused || !value?.ask || value.stage !== 3) return;
    let cancelled = false;
    void invoke("ultimate_show", { taskId: session.task?.id }).catch(e => {
      if (!cancelled) setError(`궁극기 창을 표시하지 못했어요. ${String(e)}`);
    });
    return () => { cancelled = true; void invoke("ultimate_hide").catch(() => {}); };
  }, [consent, session.running, session.paused, session.task?.id, value?.id, value?.ask?.video_id, value?.stage]);
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
      judgments.current.clear(); dismissed.current.clear();
      write({ ...created, ask: null, reason: "" });
      await showWidget(true);
    } catch (e) {
      if (created && !read()) await api.endSession(created.id).catch(() => {});
      setError(String(e));
    } finally { startLock.current = false; setBusy(false); }
  }
  // 진행 중인 세션을 새 할 일로 바꾼다. 서버는 새 세션을 열면서 이전 세션을 'replaced'로 끝낸다.
  async function change(nextTask: string, options: { stayInWidget?: boolean } = {}): Promise<boolean> {
    const current = read();
    const name = nextTask.trim();
    if (startLock.current || busy || !ready || !current || !name) return false;
    if (name.length > 100 || /[\r\n]/.test(name)) {
      setError("지금 집중할 일을 100자 이내의 한 줄로 입력해 주세요.");
      return false;
    }
    if (name === current.task) return true;
    startLock.current = true;
    setBusy(true); setError("");
    // 이전 할 일 기준의 영상 판단은 바로 멈춘다.
    write(null);
    let created: { id: number; task: string } | null = null;
    try {
      await sessionStore.send({ type: "end" });
      created = await api.startSession(name);
      await sessionStore.send({ type: "start", task: { id: TASK_OFFSET + created.id, name: created.task } });
      judgments.current.clear(); dismissed.current.clear(); clock.current.clear();
      write({ ...created, ask: null, reason: "" });
      setTask("");
      if (!options.stayInWidget) await showWidget(true);
      return true;
    } catch (e) {
      if (created && !read()) await api.endSession(created.id).catch(() => {});
      setError(`할 일을 바꾸지 못했어요. ${String(e)}`);
      return false;
    } finally { startLock.current = false; setBusy(false); }
  }
  // 위젯에서 보낸 "할 일 바꾸기"도 같은 change()로 처리한다 (메인 창은 열지 않는다).
  const changeRef = useRef(change);
  changeRef.current = change;
  useEffect(() => cloudMemory.handleChange(next => changeRef.current(next, { stayInWidget: true })), []);
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
  return { value, session, ready, task, setTask, consent, setConsent, busy, error, start, change, end };
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
