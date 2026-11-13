import { useEffect, useState } from "react";
import { isDesktop } from "../desktop/bridge";
import { activityApi, categoryLabels, useActivity } from "./bridge";
import "./activity.css";
import BrowserControls from "./BrowserControls";

export default function ActivityControls() {
  const { activity, error: syncError } = useActivity();
  const [consent, setConsent] = useState(false);
  const [related, setRelated] = useState("");
  const [suspect, setSuspect] = useState("");
  const [seconds, setSeconds] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setConsent(activity.consent), [activity.consent]);
  if (!isDesktop()) return null;
  async function configure(enabled: boolean) {
    setBusy(true); setError("");
    try {
      await activityApi.configure(enabled ? { consent: true, thresholdSeconds: seconds,
        relatedTerms: related.split(","), suspectTerms: suspect.split(",") } : { ...activity, consent: false });
      if (!enabled) setConsent(false);
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  return <details className="activity-controls">
    <summary>Windows 활동 감지 · {activity.consent ? activity.monitoring ? categoryLabels[activity.category] : "세션 대기" : "꺼짐"}</summary>
    <p>동의한 집중 세션에서만 활성 창의 제목·프로세스와 유지 시간을 이 PC 메모리에서 확인해요. 키 입력과 화면은 수집하지 않고, 창 정보는 서버로 보내지 않아요. 앱을 닫으면 지워져요.</p>
    <label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked && activity.consent) void configure(false); }} /> 위 내용을 이해했으며 로컬 활동 감지에 동의합니다</label>
    <div className="activity-fields">
      <label>관련 활동 단어 (쉼표 구분)<input value={related} onChange={e => setRelated(e.target.value)} placeholder="강의, 논문, 프로젝트 이름" /></label>
      <label>이탈 의심 단어 (쉼표 구분)<input value={suspect} onChange={e => setSuspect(e.target.value)} placeholder="직접 지정한 게임·영상 제목" /></label>
      {import.meta.env.DEV && <label>개발 전용 확인 기준 (초)<input type="number" min={10} max={3600} value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>}
    </div>
    <p>기본 기준 5분 · 브라우저는 기본 미분류 · 60초 이상 입력이 없으면 유휴로 제외해요. 확장 프로그램으로 활성 YouTube 영상 재생이 확인되면 입력이 없어도 관측해요. 정상 공부라고 답하면 같은 영상 ID 또는 창 제목은 이번 세션에서 관련 활동으로 정정해요.</p>
    <button disabled={!consent || busy} onClick={() => void configure(true)}>동의하고 감지 설정 적용</button>{" "}
    <button disabled={!activity.consent || busy} onClick={() => void configure(false)}>감지 중지 · 관측 정보 지우기</button>
    <BrowserControls activityConsent={activity.consent} />
    {activity.totals && <section aria-label="로컬 활동 통계">
      <strong>이번 앱 실행의 로컬 기록</strong>
      <p>관련 활동 관측 {activity.totals.focusSeconds}초 · 이탈 의심 {activity.totals.suspicions}회 · 고해성사 확인 {activity.totals.confessions}회 · 오탐 정정 {activity.totals.corrections}회</p>
      <p>최근 공부 복귀: {activity.totals.lastReturnSeconds === null ? "아직 확인되지 않음" : `${activity.totals.lastReturnSeconds}초`} · 의심 알림부터 관련 활동을 다시 관측할 때까지의 시간이에요.</p>
      <small>집중 시간은 관련 활동으로 관측된 시간의 추정치예요. 기록은 이 PC 메모리에만 있고 앱 종료 시 지워져요.</small>
    </section>}
    {activity.current && <p className="activity-observation">{categoryLabels[activity.category]} · {activity.heldSeconds}초 관측 · {activity.current.process}<br />{activity.current.title}</p>}
    {(error || syncError || activity.error) && <p role="alert">{error || syncError || activity.error}</p>}
  </details>;
}
