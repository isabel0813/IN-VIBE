import { lazy, Suspense, useEffect, useState } from "react";
import { CloudQuestion, useCloudController } from "./components/CloudSession";
import Icon from "./components/Icon";
import ActivityControls from "./activity/ActivityControls";
import { isDesktop, onNavigate, showWidget } from "./desktop/bridge";
import { sessionStore, useFocusSession } from "./session/store";
import { characterArt } from "./widget/character";
import { WebWidgetPreview } from "./widget/Widget";

const LegacyPlanner = lazy(() => import("./LegacyPlanner"));
type View = "focus" | "settings" | "legacy";

export default function App() {
  const [view, setView] = useState<View>("focus");
  const focus = useCloudController();
  const { error: syncError } = useFocusSession();
  const [windowError, setWindowError] = useState("");
  const { session, value, task, setTask, ready, busy, error } = focus;
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // Existing native input/plan navigation both return to the focus screen.
    void onNavigate(() => setView("focus")).then(stop => {
      if (cancelled) stop(); else dispose = stop;
    }).catch(e => setWindowError(String(e)));
    return () => { cancelled = true; dispose?.(); };
  }, []);

  async function returnToWidget() {
    setWindowError("");
    try { await showWidget(true); } catch (e) { setWindowError(String(e)); }
  }
  async function end() {
    if (value) await focus.end(value.id);
    else {
      // Existing local task sessions remain stoppable after leaving legacy UI.
      try { await sessionStore.send({ type: "end" }); }
      catch (e) { setWindowError(String(e)); }
    }
  }

  return <>
    <div className={`app-shell ${view === "focus" ? "landing-mode" : "focus-settings"}`} hidden={view === "legacy"}>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <div className="workspace">
        <main id={view === "legacy" ? undefined : "main-content"}>
          <div className="landing-screen">
            <header className="landing-header">
              <span className="landing-logo">뭐보뇽<span aria-hidden="true">.</span></span>
              <button className="landing-plan-link" type="button" onClick={() => setView(view === "focus" ? "settings" : "focus")}>
                {view === "focus" ? "설정" : "집중 화면으로"} <Icon name="arrow" />
              </button>
            </header>
            <div className="landing-connection-slot">
              {(error || windowError || syncError) && <div className="landing-connection" role="alert">
                <span title={error || windowError || syncError}>{error || windowError || syncError}</span>
                {syncError && <button className="text-button" onClick={() => void sessionStore.sync()}>다시 동기화</button>}
              </div>}
            </div>
            <div className="landing-body" hidden={view !== "focus"}>
              <div className="landing-center">
                <div className="landing-mascot"><img src={characterArt.idle} alt="안뇽이 캐릭터" /></div>
                <span className="landing-eyebrow">ONE THING AT A TIME</span>
                <h1>{session.running ? "지금은 이 일에 집중하뇽." : "오늘은 뭐 할 거뇽?"}</h1>
                <p>{session.running ? "잠깐 돌아와도 괜찮아. 준비되면 이어서 하자." : <>지금 집중할 일 하나만 말해 봐.<br />준비되면 안뇽이와 시작하자.</>}</p>
              </div>
              <section className="landing-input" aria-label="한 줄 집중 세션">
                <form className="composer landing-composer" onSubmit={event => { event.preventDefault(); void focus.start(); }}>
                  <div className="composer-heading">
                    <label htmlFor="focus-task"><Icon name="spark" />지금 공부할 일</label>
                    <span>지금 할 일 하나만</span>
                  </div>
                  <input id="focus-task" className="landing-task-input" type="text" maxLength={100}
                    value={session.running ? session.task?.name ?? "" : task}
                    disabled={busy || session.running || !!value}
                    onChange={event => setTask(event.target.value)} placeholder="예: 전자기 유도 공부" />
                  <div className="composer-bottom">
                    <span>{session.running ? session.paused ? "일시정지" : "집중 중" : `${task.length} / 100`}</span>
                    {session.running ? <button className="primary" type="button" disabled={busy || !ready} onClick={() => void returnToWidget()}>
                      {isDesktop() ? "위젯으로 돌아가기" : "위젯 미리보기"}<Icon name="arrow" />
                    </button> : <button className="primary" disabled={busy || !ready || !!value || !task.trim()}>
                      {busy ? <><span className="spinner" />시작하는 중…</> : <>집중 시작<Icon name="arrow" /></>}
                    </button>}
                  </div>
                </form>
                <div className="landing-mini-actions">
                  <button className="text-button" type="button" onClick={() => setView("settings")}>감지·AI 설정</button>
                  {(session.running || value) && <button className="text-button" disabled={busy || !ready} onClick={() => void end()}>세션 종료</button>}
                </div>
                <p className="privacy-note">감지와 AI 판단은 별도 동의 후에만 켜져요. 동의 없이도 집중을 시작할 수 있어요.</p>
                {!isDesktop() && <p className="privacy-note">웹 미리보기 · 독립 위젯과 YouTube 관측은 Windows 앱에서 사용할 수 있어요.</p>}
                <CloudQuestion />
              </section>
            </div>
            <section className="focus-settings-content" aria-label="집중 설정" hidden={view !== "settings"}>
              <h1>집중 설정</h1>
              <label><input type="checkbox" checked={focus.consent} onChange={event => focus.setConsent(event.target.checked)} /> AI 판단에 동의합니다. 작업명과 관측한 영상 제목·ID를 API로 보내며 AI가 제목을 분류합니다.</label>
              <p>Windows 활동 감지와 YouTube 연결에도 각각 동의해야 영상 판단이 시작돼요. AI 동의는 앱을 다시 열면 꺼져요.</p>
              <ActivityControls />
              {!isDesktop() && <p>Windows 활동 감지는 데스크톱 앱에서 설정할 수 있어요.</p>}
              <p><a href="/install.html" target="_blank" rel="noreferrer">Windows·Chrome 설치 안내</a></p>
              <details>
                <summary>기존 작업 데이터</summary>
                <p>이전에 등록한 작업은 보존되어 있어요. 이전 화면은 선택한 경우에만 불러와요.</p>
                <button className="text-button" disabled={busy || session.running || !!value} onClick={() => setView("legacy")}>기존 작업 보기</button>
                {session.running && <p>집중 세션을 종료한 뒤 기존 작업을 확인해 주세요.</p>}
              </details>
            </section>
          </div>
        </main>
      </div>
    </div>
    {view === "legacy" && <>
      <div className="legacy-return"><button className="text-button" onClick={() => setView("focus")}>한 줄 집중 화면으로</button></div>
      <Suspense fallback={<p role="status">기존 작업 화면을 불러오고 있어요.</p>}><LegacyPlanner embedded /></Suspense>
    </>}
    {!isDesktop() && <WebWidgetPreview />}
  </>;
}
