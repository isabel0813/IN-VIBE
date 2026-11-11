import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type { Plan, Settings, Task } from "./api/types";
import {
  blankDraft,
  editDraft,
  serializeDrafts,
  validateDrafts,
} from "./lib/drafts";
import type { EditableDraft } from "./lib/drafts";
import DraftEditor from "./components/DraftEditor";
import PlanView from "./components/PlanView";
import Icon from "./components/Icon";
import { sessionStore, useFocusSession } from "./session/store";
import { isDesktop, onNavigate, showWidget } from "./desktop/bridge";
import { WebWidgetPreview } from "./widget/Widget";
import DevControls from "./widget/DevControls";

type Step = "input" | "review" | "plan";
const example =
  "물리 과제 내일 밤 10시까지, 2시간 정도 걸려\n금요일 오후 6시까지 프로젝트 발표 준비, 중요해\n이번 주 토요일까지 읽던 책 마저 읽기";
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "요청을 처리하지 못했어요. 다시 시도해 주세요.";

export default function App() {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const {
    session,
    ready: sessionReady,
    error: sessionError,
  } = useFocusSession();
  const activeId = session.running ? (session.task?.id ?? null) : null;
  const [sessionBusy, setSessionBusy] = useState(false);
  const sessionLock = useRef(false);
  const requestVersion = useRef(0);
  const parseController = useRef<AbortController | null>(null);
  const busy = saving || refreshing || sessionBusy;

  const refresh = useCallback(async (initial = false) => {
    const version = ++requestVersion.current;
    const sessionRevision = sessionStore.getSnapshot().session.revision;
    setRefreshing(true);
    try {
      const [nextTasks, nextPlan, nextSettings] = await Promise.all([
        api.tasks(),
        api.plan(),
        api.settings(),
      ]);
      if (version !== requestVersion.current) return;
      setTasks(nextTasks);
      setPlan(nextPlan);
      setSettings(nextSettings);
      setConnectionError("");
      const current = sessionStore.getSnapshot().session;
      if (
        current.running &&
        current.task &&
        current.revision === sessionRevision
      ) {
        const task = nextTasks.find((item) => item.id === current.task?.id);
        const action = !task
          ? { type: "end" as const }
          : task.done
            ? { type: "complete" as const, task_id: task.id }
            : task.name !== current.task.name
              ? {
                  type: "rename" as const,
                  task: { id: task.id, name: task.name },
                }
              : null;
        if (action)
          void sessionStore
            .send(action)
            .catch((error) => setNotice(errorMessage(error)));
      }
      if (initial && nextTasks.length) setStep("plan");
    } catch (error) {
      if (version === requestVersion.current) {
        setConnectionError(errorMessage(error));
        setPlan(null);
      }
    } finally {
      if (version === requestVersion.current) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void onNavigate((target) => {
      setStep(target);
      setNotice("");
      if (target === "plan") void refresh();
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else dispose = unlisten;
      })
      .catch((error) =>
        setNotice(`화면 연결을 준비하지 못했어요. ${String(error)}`),
      );
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [refresh]);

  async function startSession(id: number | null) {
    if (sessionLock.current || !sessionReady) return;
    sessionLock.current = true;
    setSessionBusy(true);
    try {
      if (id === null) await sessionStore.send({ type: "end" });
      else {
        const task = tasks.find((item) => item.id === id && !item.done);
        if (!task)
          throw new Error(
            "시작할 작업을 찾지 못했어요. 계획을 새로고침해 주세요.",
          );
        await sessionStore.send({
          type: "start",
          task: { id: task.id, name: task.name },
        });
        await showWidget(true);
      }
    } catch (error) {
      setNotice(`집중 세션 또는 위젯을 확인해 주세요. ${String(error)}`);
    } finally {
      sessionLock.current = false;
      setSessionBusy(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    return () => {
      requestVersion.current++;
      parseController.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (step !== "plan" || busy) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [step, busy, refresh]);

  function manual() {
    parseController.current?.abort();
    setParsing(false);
    setDrafts([blankDraft()]);
    setAssumptions([]);
    setEditingId(null);
    setFormError("");
    setStep("review");
  }

  async function parse() {
    if (!text.trim() || parsing) return;
    const controller = new AbortController();
    parseController.current = controller;
    setParsing(true);
    setFormError("");
    setNotice("");
    try {
      const result = await api.parse(text.trim(), controller.signal);
      if (controller.signal.aborted) return;
      if (
        !Array.isArray(result.drafts) ||
        !result.drafts.length ||
        result.drafts.length > 30
      )
        throw new Error(
          "초안을 만들지 못했어요. 작업을 30개 이내로 나누거나 직접 입력해 주세요.",
        );
      setDrafts(result.drafts.map(editDraft));
      setAssumptions(result.assumptions);
      setEditingId(null);
      setStep("review");
    } catch (error) {
      if (!controller.signal.aborted) {
        manual();
        setNotice(`${errorMessage(error)} 원문을 참고해 아래에 입력해 주세요.`);
      }
    } finally {
      if (parseController.current === controller) setParsing(false);
    }
  }

  async function save() {
    if (saving) return;
    const validation = validateDrafts(drafts);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = serializeDrafts(drafts);
      if (editingId !== null) {
        const updated = await api.updateTask(editingId, payload[0]);
        setTasks((previous) =>
          previous.map((task) => (task.id === updated.id ? updated : task)),
        );
      } else {
        const created = await api.createBatch(payload);
        setTasks((previous) => [...previous, ...created]);
      }
      setPlan(null);
      setStep("plan");
      setDrafts([]);
      setEditingId(null);
      setText("");
      setNotice("저장했어요. 지금 할 일을 확인해 보세요.");
      await refresh();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(task: Task) {
    if (busy) return;
    setSaving(true);
    setNotice("");
    try {
      const updated = await api.updateTask(task.id, { done: !task.done });
      setTasks((previous) =>
        previous.map((item) => (item.id === task.id ? updated : item)),
      );
      if (updated.done && activeId === task.id)
        await sessionStore.send({ type: "complete", task_id: task.id });
      setPlan(null);
      setNotice(
        updated.done
          ? "한 걸음 끝냈어요. 다음 할 일을 확인해 보세요."
          : "작업을 다시 계획에 넣었어요.",
      );
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function addTasks() {
    setStep("input");
    setNotice("");
    setFormError("");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            if (!busy && !parsing) addTasks();
          }}
        >
          <span className="brand-mark">
            <Icon name="check" />
          </span>
          <span>
            바꿔도 돼<span className="brand-question">?</span>
            <small>나의 다음 한 걸음</small>
          </span>
        </a>
        <div className="sidebar-label">MY SPACE</div>
        <nav aria-label="주 메뉴">
          <button
            className={step !== "plan" ? "nav-item selected" : "nav-item"}
            disabled={busy || parsing}
            onClick={addTasks}
          >
            <Icon name="plus" />할 일 정리
          </button>
          <button
            className={step === "plan" ? "nav-item selected" : "nav-item"}
            disabled={busy || parsing}
            onClick={() => {
              setStep("plan");
              setNotice("");
              void refresh();
            }}
          >
            <Icon name="list" />
            나의 계획
            <span className="nav-count">
              {tasks.filter((task) => !task.done).length}
            </span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="small-orbit" aria-hidden="true">
            ↗
          </div>
          <p>
            계획이 조금 달라져도,
            <br />
            <strong>다시 시작하면 되니까.</strong>
          </p>
          <span>ONE THING AT A TIME</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            나의 공간 <span className="breadcrumb-divider">/</span>{" "}
            <strong>{step === "plan" ? "나의 계획" : "할 일 정리"}</strong>
          </span>
          <div className="connection">
            <span className={`live-dot ${connectionError ? "offline" : ""}`} />
            {refreshing
              ? "불러오는 중"
              : connectionError
                ? "연결 확인 필요"
                : "계획 동기화됨"}
            <button
              className="icon-button"
              aria-label="계획 새로고침"
              disabled={busy || parsing}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </header>
        <main id="main-content">
          <div className="desktop-session-bar">
            <span>
              {isDesktop()
                ? "안뇽이 데스크톱"
                : "안뇽이 웹 미리보기 · OS 창 제어 없음"}
            </span>
            {session.running && (
              <span>
                {session.paused ? "일시정지" : "집중 중"} · {session.task?.name}
              </span>
            )}
            <button
              disabled={sessionBusy || !sessionReady}
              onClick={() =>
                void showWidget().catch((error) => setNotice(String(error)))
              }
            >
              {isDesktop() ? "안뇽이 표시" : "위젯 미리보기"}
            </button>
            {session.running && (
              <button
                disabled={sessionBusy}
                onClick={() =>
                  void showWidget(true).catch((error) =>
                    setNotice(String(error)),
                  )
                }
              >
                {isDesktop() ? "위젯으로 돌아가기" : "미리보기 열기"}
              </button>
            )}
            {sessionError && (
              <span className="session-error" role="alert">
                {sessionError}
                <button onClick={() => void sessionStore.sync()}>
                  다시 동기화
                </button>
              </span>
            )}
          </div>
          <ol className="steps" aria-label="진행 단계">
            {[
              ["input", "할 일 입력"],
              ["review", "확인하기"],
              ["plan", "작업 시작"],
            ].map(([key, label], index) => (
              <li
                className={step === key ? "current" : ""}
                aria-current={step === key ? "step" : undefined}
                key={key}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
                {index < 2 && <i aria-hidden="true" />}
              </li>
            ))}
          </ol>
          {connectionError && (
            <div className="error-banner" role="alert">
              <strong>연결을 확인해 주세요</strong>
              <span>{connectionError}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                다시 연결
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Icon name="spark" />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="알림 닫기"
                onClick={() => setNotice("")}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {initialLoading ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              나의 할 일을 불러오고 있어요.
            </div>
          ) : step === "input" ? (
            <>
              <div className="intro">
                <span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
                <h1>
                  머릿속 할 일, <br />
                  여기에 내려놓으세요.
                </h1>
                <p>
                  해야 할 일을 편하게 적어 주세요.
                  <br />
                  남은 시간에 맞춰, 지금 시작할 일을 함께 정리할게요.
                </p>
              </div>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void parse();
                }}
              >
                <div className="composer-heading">
                  <label htmlFor="task-text">
                    <Icon name="list" />
                    어떤 일을 해야 하나요?
                  </label>
                  <span>한 번에 여러 개도 괜찮아요</span>
                </div>
                <textarea
                  id="task-text"
                  maxLength={2000}
                  value={text}
                  disabled={parsing}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={
                    "예를 들면,\n물리 과제 내일 밤 10시까지, 2시간 정도 걸려\n금요일까지 프로젝트 발표 준비, 이건 중요해"
                  }
                />
                <div className="composer-bottom">
                  <span>{text.length.toLocaleString()} / 2,000</span>
                  <button
                    className="primary"
                    disabled={!text.trim() || parsing}
                  >
                    {parsing ? (
                      <>
                        <span className="spinner" />
                        정리하는 중…
                      </>
                    ) : (
                      <>
                        <Icon name="spark" />
                        AI로 할 일 정리
                        <Icon name="arrow" />
                      </>
                    )}
                  </button>
                </div>
              </form>
              {parsing && (
                <p className="helper" role="status">
                  처음에는 AI 준비에 최대 2분 정도 걸릴 수 있어요. 기다리는 동안
                  직접 입력으로 전환할 수 있어요.
                </p>
              )}
              {formError && (
                <p className="error-message" role="alert">
                  {formError}
                </p>
              )}
              <div className="input-actions">
                <span>직접 정리하고 싶다면</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setNotice("마감 시간과 예상 시간을 직접 입력해 주세요.");
                    manual();
                  }}
                >
                  직접 입력하기 <Icon name="arrow" />
                </button>
              </div>
              <section className="example-card">
                <span className="example-label">이렇게 적어 보세요</span>
                <button
                  className="text-button"
                  disabled={parsing}
                  onClick={() => setText(example)}
                >
                  예시 사용하기 <Icon name="plus" />
                </button>
                <p>“물리 과제 내일 밤 10시까지, 2시간 정도 걸려”</p>
                <div className="example-tags">
                  <span>무엇을 할지</span>
                  <span>언제까지</span>
                  <span>얼마나 걸릴지</span>
                </div>
                <small>
                  예상 시간을 몰라도 괜찮아요. AI 초안을 보고 수정할 수 있어요.
                </small>
              </section>
              <p className="privacy-note">
                <span className="tiny-check">✓</span> 입력한 할 일은 확인한 후에
                저장돼요.
              </p>
            </>
          ) : step === "review" ? (
            <>
              {text && (
                <details className="original-text">
                  <summary>입력한 원문 보기</summary>
                  <p>{text}</p>
                </details>
              )}
              <DraftEditor
                drafts={drafts}
                onChange={setDrafts}
                assumptions={assumptions}
                busy={saving}
                editing={editingId !== null}
                error={formError}
                onSave={() => void save()}
                onBack={() => {
                  setStep(editingId !== null ? "plan" : "input");
                  setFormError("");
                }}
              />
            </>
          ) : (
            <PlanView
              tasks={tasks}
              plan={plan}
              settings={settings}
              busy={busy || !sessionReady}
              activeId={activeId}
              paused={session.paused}
              onStart={(id) => void startSession(id)}
              onDone={(task) => void toggleDone(task)}
              onAdd={addTasks}
              onEdit={(task) => {
                setEditingId(task.id);
                setDrafts([editDraft(task)]);
                setAssumptions([]);
                setFormError("");
                setNotice("");
                setStep("review");
              }}
            />
          )}
        </main>
        {import.meta.env.DEV && <DevControls />}
        {!isDesktop() && <WebWidgetPreview />}
        <footer className="app-footer">
          <span>바꿔도 돼?</span>작은 시작이, 하루를 바꾸니까.
        </footer>
      </div>
    </div>
  );
}
