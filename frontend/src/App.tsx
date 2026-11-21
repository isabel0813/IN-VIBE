import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CloudQuestion, UltimateOverlay, useCloudController } from "./components/CloudSession";
import Icon from "./components/Icon";
import ActivityControls from "./activity/ActivityControls";
import { useActivity } from "./activity/bridge";
import { isDesktop, onNavigate, showWidget } from "./desktop/bridge";
import { sessionStore, useFocusSession } from "./session/store";
import { setBreakUntil, useAutoResume } from "./session/breakTimer";
import { annyongArt } from "./widget/character";
import { WebWidgetPreview } from "./widget/Widget";
import { ReplyNotice, useReply, useTone } from "./components/persona";

const LegacyPlanner = lazy(() => import("./LegacyPlanner"));
type View = "focus" | "settings" | "legacy";

export default function App() {
  const [tone, setTone] = useTone();
  const reply = useReply();
  const [view, setView] = useState<View>("focus");
  const [menuOpen, setMenuOpen] = useState(false);
  // 위젯의 "할 일 바꾸기"로 들어오면 입력칸을 다시 열어 새 할 일을 받는다.
  const [changing, setChanging] = useState(false);
  const taskInput = useRef<HTMLInputElement>(null);
  const { activity } = useActivity();
  const focus = useCloudController(activity);
  const { error: syncError } = useFocusSession();
  const [windowError, setWindowError] = useState("");
  const { session, value, task, setTask, ready, busy, error } = focus;
  const ultimate = (value?.stage === 3 && !!value.ask) || !!focus.inactivityUltimate;
  // 위젯에서 정한 쉬는 시간이 끝나면 메인 창이 세션을 다시 시작한다.
  useAutoResume();

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void onNavigate(target => {
      setView("focus"); setMenuOpen(false);
      if (target === "input") setChanging(true);
    }).then(stop => {
      if (cancelled) stop(); else dispose = stop;
    }).catch(e => setWindowError(String(e)));
    return () => { cancelled = true; dispose?.(); };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => {
    if (!session.running) { setChanging(false); return; }
    if (!changing) return;
    setTask(session.task?.name ?? "");
    requestAnimationFrame(() => { taskInput.current?.focus(); taskInput.current?.select(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changing, session.running]);
  function navigate(next: View) { setView(next); setMenuOpen(false); }
  async function changeTask() {
    if (await focus.change(task)) setChanging(false);
  }
  async function returnToWidget() {
    setWindowError("");
    try { await showWidget(true); } catch (e) { setWindowError(String(e)); }
  }
  async function end() {
    setBreakUntil(null);
    if (value) await focus.end(value.id);
    else {
      try { await sessionStore.send({ type: "end" }); }
      catch (e) { setWindowError(String(e)); }
    }
  }

  return <>
    <div className="app-shell clean" hidden={view === "legacy"} inert={ultimate}>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <header className="home-bar">
        <button className="home-brand" onClick={() => navigate("focus")}>
          <span className="home-brand-mark" aria-hidden="true"><Icon name="spark" /></span>뭐보뇽
        </button>
        <div className="home-bar-actions">
          {session.running && <span className="home-bar-status"><span className="live-dot" />{session.paused ? "일시정지" : "집중 중"}</span>}
          <button className="round-button" aria-label="메뉴 열기" aria-expanded={menuOpen} aria-controls="app-menu" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        </div>
      </header>
      <div className="menu-backdrop" hidden={!menuOpen} onClick={() => setMenuOpen(false)} />
      <aside id="app-menu" className="menu-drawer" aria-label="메뉴" hidden={!menuOpen}>
        <div className="menu-head"><strong>메뉴</strong><button className="icon-button" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)}><Icon name="close" /></button></div>
        <nav className="menu-nav" aria-label="주 메뉴">
          <button className={`menu-item ${view === "settings" ? "selected" : ""}`} onClick={() => navigate("settings")}><Icon name="menu" />감지·AI 설정</button>
        </nav>
        <section className="menu-section">
          <h2>설치</h2>
          <a href="/install.html" target="_blank" rel="noreferrer">Windows·Chrome 설치 안내</a>
          <a href="https://github.com/isabel0813/IN-VIBE/releases/download/v0.3.2-test-20261118/Mobonyong-Windows-v0.3.2-test-20261118.zip">Windows 시험판 다운로드</a>
        </section>
      </aside>

      <main id={view === "legacy" ? undefined : "main-content"} className={view === "focus" ? "home-main" : "page-main"}>
        {(error || windowError || syncError) && <div className="focus-notice" role="alert">
          <span>{error || windowError || syncError}</span>
          {syncError && <button className="text-button" onClick={() => void sessionStore.sync()}>다시 동기화</button>}
        </div>}
        <section className="home-hero" aria-label="한 줄 집중 세션" hidden={view !== "focus"}>
          <div className="hero-character"><img src={annyongArt} alt="안뇽이 캐릭터" /></div>
          <h1>{session.running ? "지금 집중하는 목표" : "오늘 끝낼 일은?"}</h1>
          <p className="hero-sub">{session.running ? "잠깐 돌아와도 괜찮아. 준비되면 이어서 하자." : "자세히 적을수록 안뇽이가 더 잘 알아볼 수 있어!"}</p>
          <form className="hero-form" onSubmit={event => { event.preventDefault(); void (changing ? changeTask() : focus.start()); }}>
            <div className="hero-input">
              <input ref={taskInput} id="focus-task" type="text" aria-label="지금 공부할 일" maxLength={100}
                value={session.running && !changing ? session.task?.name ?? "" : task} disabled={busy || (session.running && !changing) || (!!value && !changing)}
                onChange={event => setTask(event.target.value)} placeholder="예: 물리학2 패러데이 법칙 공부하기" />
              {(!session.running || changing) && <button type="submit" className="hero-send" aria-label="할 일 보내기" disabled={busy || !ready || !task.trim()}><Icon name="arrow" /></button>}
            </div>
            {changing && session.running ? <button className="hero-start" disabled={busy || !ready || !task.trim()}>{busy ? <><span className="spinner" />바꾸는 중…</> : <>할 일 바꾸기</>}</button>
              : session.running ? <button className="hero-start" type="button" disabled={busy || !ready} onClick={() => void returnToWidget()}>{isDesktop() ? "위젯으로 돌아가기" : "위젯 미리보기"}<Icon name="arrow" /></button>
              : <button className="hero-start" disabled={busy || !ready || !!value || !task.trim()}>{busy ? <><span className="spinner" />시작하는 중…</> : <><Icon name="play" />집중 시작</>}</button>}
          </form>
          {(session.running || value) && <div className="hero-links">
            {changing
              ? <button className="link" disabled={busy} onClick={() => { setChanging(false); setTask(""); }}>취소</button>
              : <button className="link" disabled={busy || !ready} onClick={() => setChanging(true)}>할 일 바꾸기</button>}
            <span aria-hidden="true">·</span>
            <button className="link" disabled={busy || !ready} onClick={() => void end()}>세션 종료</button>
          </div>}
          {!isDesktop() && <p className="hero-note">웹 미리보기 · 독립 위젯과 YouTube 관측은 Windows 앱에서 사용할 수 있어요.</p>}
          <CloudQuestion />
          {!value?.ask && !activity.incident && reply && session.task && <ReplyNotice mode={reply.mode} task={session.task.name} />}
        </section>
        <section className="focus-settings-content" aria-label="집중 설정" hidden={view !== "settings"}>
          <div className="page-head">
            <button className="back-button" aria-label="집중 화면으로 돌아가기" onClick={() => navigate("focus")}><Icon name="back" />뒤로</button>
            <h1>집중 설정</h1>
          </div>
          <label className="hero-consent"><input type="checkbox" checked={focus.consent} onChange={event => focus.setConsent(event.target.checked)} /><span>AI 판단에 동의합니다. 작업명과 관측한 영상 제목·ID를 API로 보내며 AI가 제목을 분류합니다.</span></label>
          <p className="hero-note">Windows 활동 감지와 YouTube 연결에도 각각 동의해야 영상 판단이 시작돼요. AI 동의는 체크를 풀기 전까지 유지돼요.</p>
          <ActivityControls />
          <fieldset className="tone-settings">
            <legend>안뇽이 말투</legend>
            <label><input type="radio" name="annyong-tone" checked={tone === "default"} onChange={() => setTone("default")} /> 기본 · 욕설 없는 독설</label>
            <label><input type="radio" name="annyong-tone" checked={tone === "hardcore"} onChange={() => setTone("hardcore")} /> 하드코어 · 욕설과 과장된 농담</label>
          </fieldset>
          {!isDesktop() && <p className="hero-note">Windows 활동 감지는 데스크톱 앱에서 설정할 수 있어요.</p>}
          <details className="legacy-access"><summary>기존 작업 데이터</summary><p>이전에 등록한 작업은 기존 화면에서 확인할 수 있어요.</p>
            <button className="secondary" disabled={busy || session.running || !!value} onClick={() => navigate("legacy")}>기존 작업 보기</button>
          </details>
        </section>
      </main>
    </div>
    {view === "legacy" && <><div className="legacy-return"><button className="text-button" onClick={() => navigate("focus")}>한 줄 집중 화면으로</button></div><Suspense fallback={<p role="status">기존 작업 화면을 불러오고 있어요.</p>}><LegacyPlanner embedded /></Suspense></>}
    {!isDesktop() && <WebWidgetPreview />}
    <UltimateOverlay onEnd={() => void end()} inactivity={focus.inactivityUltimate} />
  </>;
}
