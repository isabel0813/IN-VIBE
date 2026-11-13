import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { RecoveryPlan } from "../api/types";
import { showMain, showWidget } from "../desktop/bridge";
import { sessionStore } from "../session/store";
import { activityApi } from "./bridge";
import type { Incident } from "./bridge";
import "./activity.css";

export default function RecoveryFlow({ incident, paused }: { incident: Incident | null; paused: boolean }) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [result, setResult] = useState<RecoveryPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  useEffect(() => {
    if (incident) { setEditing(false); setResult(null); setError(""); }
  }, [incident?.id]);
  async function respond(choice: "studying" | "break" | "resolved") {
    if (!incident || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { await activityApi.respond(incident.id, choice); }
    catch (failure) { setError(String(failure)); }
    finally { sending.current = false; setBusy(false); }
  }
  async function recover() {
    if (!incident || incident.claimed || sending.current || paused) return;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { setError("0~1440분의 정수로 입력해 주세요."); return; }
    sending.current = true; setBusy(true); setError("");
    let claimed = false;
    try {
      // Native reservation survives React remounts and protects against double clicks/windows.
      await activityApi.respond(incident.id, "claim"); claimed = true;
      const response = await api.wasted(minutes);
      setResult(response);
      await activityApi.respond(incident.id, "resolved");
    } catch (failure) {
      setError(claimed ? `전송 결과를 확인할 수 없어요. 중복 기록을 막기 위해 재전송하지 않습니다. 계획 보기에서 현재 계획을 확인해 주세요. ${String(failure)}` : String(failure));
    } finally { sending.current = false; setBusy(false); }
  }
  if (!incident && !result) return null;
  return <section className="recovery-flow" aria-label="활동 확인과 계획 복구">
    {result ? <>
      <strong>놀랍게도 아직 안 망했다. 다시 시작하자.</strong>
      <p>확인한 이탈 {result.wasted_minutes}분 · 현재 계획 기준</p>
      <p>다음 할 일: {result.plan.now_task?.name ?? "계획에서 마감과 작업을 확인해 주세요."}<br />여유 {result.plan.free_minutes ?? 0}분 · 부족 {result.plan.order.reduce((sum, task) => sum + task.short_minutes, 0)}분</p>
      {result.impacts.map(item => <p key={item.task_id}>{item.name}: {item.overdue ? "마감 지남" : `부족 시간 ${item.lost_minutes}분 증가`}</p>)}
      <button disabled={busy} onClick={() => {
        const task = result.plan.now_task;
        if (!task) { void showMain("plan"); return; }
        setBusy(true);
        void sessionStore.send({ type: "start", task: { id: task.task_id, name: task.name } })
          .then(() => showWidget(true)).then(() => setResult(null))
          .catch(failure => setError(String(failure))).finally(() => setBusy(false));
      }}>{result.plan.now_task ? "다음 할 일에 집중하기" : "계획 확인하기"}</button>
    </> : incident && <>
      <p>이탈 의심 창을 연속 {Math.floor(incident.seconds / 60)}분 {incident.seconds % 60}초 관측했어. 실제 딴짓인지는 네가 확인해 줘.</p>
      <p className="observed-title">{incident.process} · {incident.title}</p>
      {incident.claimed ? <>
        <p>이미 전송을 시도한 확인이에요. 응답이 없으면 현재 계획을 확인해 주세요. 자동 재전송하지 않아요.</p>
        <button disabled={busy} onClick={() => void respond("resolved")}>확인 마치기</button>
      </> : editing ? <>
        <label>실제 이탈 시간 (분)<input aria-label="실제 이탈 시간 (분)" type="number" min={0} max={1440} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label>
        <p>분 미만은 기본값에서 제외해요. 관측 이후 시간은 자동으로 더하지 않아요.</p>
        <button disabled={busy || paused} onClick={() => void recover()}>시간 확인하고 계획 복구</button>
        <button disabled={busy} onClick={() => setEditing(false)}>다시 선택</button>
      </> : <>
        <button disabled={busy || paused} onClick={() => { setMinutes(Math.min(1440, Math.floor(incident.seconds / 60))); setEditing(true); }}>맞아, 딴짓했어</button>
        <button disabled={busy} onClick={() => void respond("studying")}>아니, 공부 중이었어</button>
        <button disabled={busy} onClick={() => void respond("break")}>잠깐 쉬는 중이야</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
