import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import {
  closedLayout,
  isDesktop,
  nativeWidget,
  showMain,
} from "../desktop/bridge";
import type { WidgetLayout } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import type { SessionAction } from "../session/model";
import { characterArt, characterCopy } from "./character";
import { bubblePlacement, previewPlacement } from "./geometry";
import "./widget.css";
import { activityApi, useActivity } from "../activity/bridge";
import RecoveryFlow from "../activity/RecoveryFlow";
import { CloudQuestion, useCloudSession } from "../components/CloudSession";
import { cloudMemory } from "../components/cloudMemory";
import { ReplyNotice, useReply } from "../components/persona";
import InactivityQuestion from "../activity/InactivityQuestion";
import Icon from "../components/Icon";
import {
  BREAK_MAX,
  BREAK_MIN,
  BREAK_STEP,
  formatRemaining,
  setBreakUntil,
  useBreakRemaining,
} from "../session/breakTimer";

export default function Widget({ native = isDesktop() }: { native?: boolean }) {
  const { session, ready, error: syncError } = useFocusSession();
  const { activity } = useActivity();
  const cloud = useCloudSession();
  const [layout, setLayout] = useState<WidgetLayout>(closedLayout);
  const [position, setPosition] = useState({
    x: window.innerWidth - 104,
    y: window.innerHeight - 104,
  });
  const [windowReady, setWindowReady] = useState(!native);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const pet = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const moved = useRef(false);
  const shownPrompts = useRef(new Map<string, { answeredAt?: number; stage: number }>());
  const windowActions = useRef(Promise.resolve());
  // 일시정지 쉬는 시간 (분). 일시정지 버튼에 마우스를 올리면 고른다.
  const [breakMinutes, setBreakMinutes] = useState(10);
  const [breakPickerOpen, setBreakPickerOpen] = useState(false);
  const [nextTask, setNextTask] = useState("");
  const breakRemaining = useBreakRemaining();
  const reply = useReply();
  const canIntervene = session.running && !session.paused && (!native || activity.consent);
  const question = canIntervene ? cloud?.ask : null;
  const incident = canIntervene && !question && activity.consent ? activity.incident : null;
  const inactivityStage = incident?.kind === "inactivity" ? incident.stage : undefined;
  const promptKey = question ? `youtube:${cloud?.id}:${question.video_id}`
    : inactivityStage !== undefined ? `inactivity:${incident?.id}` : undefined;
  const promptStage = question ? cloud?.stage ?? 1 : inactivityStage ?? 0;
  const answeredAt = question ? cloudMemory.responses().find(response => response.video === question.video_id)?.at : undefined;
  const character = question || inactivityStage === 1 || inactivityStage === 2 ? "suspect" : session.character;
  const copy = characterCopy[character];
  const nudge = question ? (cloud?.stage === 2 ? "목표 다시 확인" : "목표 확인")
    : inactivityStage === 2 ? "집중 상태 다시 확인"
      : inactivityStage === 1 ? "집중 상태 확인"
        : incident?.kind !== "inactivity" && incident && character === "suspect" ? "잠깐, 확인!" : "";
  const preview = previewPlacement(
    position.x,
    position.y,
    window.innerWidth,
    window.innerHeight,
    layout.open,
  );
  const geometry = native ? layout : preview.layout;

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const dispose = await nativeWidget.listenLayout((value) => {
          receivedEvent = true;
          if (!cancelled) setLayout(value);
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
        const value = await nativeWidget.readLayout();
        if (!cancelled) {
          if (!receivedEvent) setLayout(value);
          setWindowReady(true);
        }
      } catch (failure) {
        if (!cancelled) setError(String(failure));
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [native]);

  const bubble = useCallback(
    (open: boolean, automatic = false) => {
      if (!native) {
        setLayout((value) => ({ ...value, open, automatic }));
        return Promise.resolve();
      }
      windowActions.current = windowActions.current.then(async () => {
        await nativeWidget.bubble(open, automatic);
      }).catch(failure => {
        setError(`말풍선을 바꾸지 못했어요. ${String(failure)}`);
      });
      return windowActions.current;
    },
    [native],
  );

  useEffect(() => {
    if (!ready || !windowReady) return;
    if (!session.running) shownPrompts.current.clear();
    if (promptKey && promptStage !== 3) {
      const previous = shownPrompts.current.get(promptKey);
      if (promptStage > 0 && (!previous || previous.answeredAt !== answeredAt || promptStage > previous.stage)) {
        shownPrompts.current.set(promptKey, { answeredAt, stage: promptStage });
        void bubble(true, true);
      }
    } else if (reply && canIntervene && promptStage !== 3) {
      if (!layout.open) void bubble(true, true);
    } else if (layout.open && (promptStage === 3 || (layout.automatic
      && (!canIntervene || session.character !== "recovery")))) {
      void bubble(false);
    }
  }, [ready, windowReady, promptKey, promptStage, answeredAt, layout.open, layout.automatic, reply, canIntervene, session.running, session.character, bubble]);

  useEffect(() => {
    if (!layout.open) return;
    if (!layout.automatic) dialog.current?.focus({ preventScroll: true });
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !layout.automatic &&
        !dialog.current?.contains(event.target as Node) &&
        !pet.current?.contains(event.target as Node)
      )
        void bubble(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void bubble(false);
      }
    };
    const blur = () => void bubble(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    // Native external-click dismissal is handled by WindowEvent::Focused(false).
    if (!native && !layout.automatic) window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [layout.open, layout.automatic, native, bubble]);

  useEffect(() => {
    if (native) return;
    const resize = () =>
      setPosition((value) => ({
        x: Math.max(0, Math.min(value.x, window.innerWidth - 80)),
        y: Math.max(0, Math.min(value.y, window.innerHeight - 80)),
      }));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [native]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }
  const send = (action: SessionAction) =>
    void run(() => sessionStore.send(action));

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    moved.current = false;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
    if (!native) event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || event.buttons !== 1) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 5) return;
    start.moved = true;
    moved.current = true;
    if (native) {
      gesture.current = null;
      void run(() => nativeWidget.drag());
    } else {
      setLayout(closedLayout);
      setPosition({
        x: Math.max(0, Math.min(start.originX + dx, window.innerWidth - 80)),
        y: Math.max(0, Math.min(start.originY + dy, window.innerHeight - 80)),
      });
    }
  }
  const style: CSSProperties = {
    width: geometry.width,
    height: geometry.height,
    ...(native ? {} : { left: preview.left, top: preview.top }),
  };
  const placement = bubblePlacement(geometry);

  return (
    <div
      ref={root}
      className={`pet-stage ${native ? "native" : "web-preview"}`}
      style={style}
      aria-label={native ? "안뇽이 위젯" : "안뇽이 웹 미리보기"}
    >
      {layout.open && (
        <div
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-label="안뇽이 말풍선"
          className={`pet-bubble ${placement.above ? "above" : "below"}`}
          style={placement.style}
          onPointerDownCapture={event => {
            if (event.button === 0 && native && layout.automatic) {
              void nativeWidget.interact().catch(failure => setError(String(failure)));
            }
          }}
        >
          <div className="pet-bubble-heading">
            <strong>
              안뇽이 <small>{session.paused ? "쉬는 중" : copy.label}</small>
            </strong>
            <button aria-label="말풍선 닫기" onClick={() => void bubble(false)}>
              ×
            </button>
          </div>
          <p className="pet-current-task">
            <span>현재 작업</span>
            <strong>{session.task?.name ?? "아직 고른 일이 없네."}</strong>
          </p>
          {session.simulated && (
            <p className="pet-simulation">
              개발 시뮬레이션 · 실제 활동 감지 없음
            </p>
          )}
          {!question && incident?.kind === "inactivity" && inactivityStage !== 3 && <InactivityQuestion incident={incident} />}
          {!question && incident?.kind !== "inactivity" && <RecoveryFlow key={session.task?.id}
            incident={incident} paused={session.paused || !session.running || !activity.consent}
            onLocalReturn={layout.automatic ? () => void bubble(false) : undefined} />}
          {question && <CloudQuestion />}
          {!question && !incident && reply && session.task && <ReplyNotice reply={reply} task={session.task.name} />}
          {session.character === "checkin" && !activity.incident && session.simulated && (
            <div className="checkin-options">
              <button
                disabled={busy || !session.running}
                onClick={() => send({ type: "checkin", choice: "distracted" })}
              >
                맞아, 딴짓했어
              </button>
              <button
                disabled={busy || !session.running}
                onClick={() => send({ type: "checkin", choice: "studying" })}
              >
                아니, 공부 중이었어
              </button>
              <button
                disabled={busy || !session.running}
                onClick={() => send({ type: "checkin", choice: "break" })}
              >
                잠깐 쉬는 중이야
              </button>
            </div>
          )}
          {session.character === "recovery" && session.simulated && (
            <p className="pet-simulation">
              딴짓 시간은 측정하지 않았어. 계획에는 반영하지 않을게.
            </p>
          )}
          {!layout.automatic && <><form
            className="pet-change-form"
            onSubmit={event => {
              event.preventDefault();
              const next = nextTask.trim();
              if (!next || busy || !session.running) return;
              void run(async () => {
                await cloudMemory.change(next);
                setNextTask("");
              });
            }}
          >
            <input
              className="pet-change"
              aria-label="할 일 바꾸기"
              placeholder="할 일 바꾸기"
              maxLength={100}
              value={nextTask}
              disabled={busy || !session.running}
              onChange={event => setNextTask(event.target.value)}
            />
            {nextTask.trim() && (
              <button type="submit" className="pet-change-send" aria-label="새 할 일 보내기" disabled={busy || !session.running}>
                <Icon name="arrow" />
              </button>
            )}
          </form>
          <div className="pet-pause-zone">
            {breakPickerOpen && session.running && !session.paused && (
              <div className="pet-break-picker" role="group" aria-label="쉬는 시간 고르기">
                <strong>{breakMinutes >= 60 ? "1시간" : `${breakMinutes}분`} 쉬기</strong>
                <span>끝나면 자동으로 다시 시작해</span>
                <div className="pet-break-slider">
                  <div className="pet-break-dots" aria-hidden="true">
                    {Array.from({ length: (BREAK_MAX - BREAK_MIN) / BREAK_STEP + 1 }, (_, i) => <i key={i} />)}
                  </div>
                  <input
                    type="range"
                    aria-label="쉬는 시간(분)"
                    min={BREAK_MIN}
                    max={BREAK_MAX}
                    step={BREAK_STEP}
                    value={breakMinutes}
                    style={{ "--fill": `${((breakMinutes - BREAK_MIN) / (BREAK_MAX - BREAK_MIN)) * 100}%` } as CSSProperties}
                    onChange={(event) => setBreakMinutes(Number(event.target.value))}
                  />
                </div>
                <div className="pet-break-buttons">
                  <button type="button" disabled={busy} onClick={() => setBreakPickerOpen(false)}>취소</button>
                  <button
                    type="button"
                    className="pet-break-start"
                    disabled={busy || !session.running}
                    onClick={() =>
                      void run(async () => {
                        await sessionStore.send({ type: "pause" });
                        setBreakUntil(Date.now() + breakMinutes * 60_000);
                        setBreakPickerOpen(false);
                      })
                    }
                  >
                    쉬기 시작
                  </button>
                </div>
              </div>
            )}
            {session.paused && breakRemaining !== null && (
              <p className="pet-break-remaining" role="status">
                {formatRemaining(breakRemaining)} 뒤 자동으로 다시 시작
              </p>
            )}
            <div className="pet-session-actions">
              <button
                disabled={busy || !session.running}
                aria-expanded={session.paused ? undefined : breakPickerOpen}
                onClick={() => {
                  if (!session.paused) { setBreakPickerOpen(open => !open); return; }
                  void run(async () => {
                    setBreakUntil(null);
                    await sessionStore.send({ type: "resume" });
                  });
                }}
              >
                {session.paused ? "재개" : "일시정지"}
              </button>
              <button
                disabled={busy || !session.running}
                onClick={() =>
                  void run(async () => {
                    setBreakUntil(null);
                    await sessionStore.send({ type: "end" });
                    await showMain("plan");
                    await bubble(false);
                  })
                }
              >
                종료
              </button>
            </div>
          </div></>}
          {(error || syncError) && (
            <p className="pet-error" role="alert">
              {error || syncError}
              <button onClick={() => void sessionStore.sync()}>
                다시 동기화
              </button>
            </p>
          )}
          {!layout.automatic && <div className="pet-footer">
            <button
              className="pet-open-main"
              aria-label="집중 화면 열기"
              title="집중 화면 열기"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await showMain("plan");
                  await bubble(false);
                })
              }
            >
              <Icon name="window" />
            </button>
          </div>}
        </div>
      )}
      <button
        ref={pet}
        className={`pet-character state-${character}`}
        style={{ left: geometry.petX, top: geometry.petY }}
        aria-label={`안뇽이: ${copy.label}. 클릭하면 말풍선, 드래그하면 이동`}
        aria-expanded={layout.open}
        disabled={!ready || !windowReady}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => {
          gesture.current = null;
          if (
            !native &&
            event.currentTarget.hasPointerCapture?.(event.pointerId)
          )
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          if (!layout.open && incident && !incident.claimed) {
            const id = incident.id;
            void run(async () => {
              await activityApi.respond(id, "review");
              await bubble(true);
            });
          } else void bubble(!layout.open);
        }}
      >
        <img draggable={false} src={characterArt[character]} alt="" />
        <span className="pet-state-dot" aria-hidden="true" />
        {!layout.open && !session.paused && nudge && <span className="pet-nudge">{nudge}</span>}
      </button>
      {!layout.open && (error || syncError) && (
        <button
          className="pet-retry"
          title={error || syncError}
          onClick={() => void showMain("plan")}
        >
          연결 확인
        </button>
      )}
    </div>
  );
}

export function WebWidgetPreview() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const change = (event: Event) =>
      setVisible((event as CustomEvent<boolean>).detail);
    window.addEventListener("web-widget-visible", change);
    return () => window.removeEventListener("web-widget-visible", change);
  }, []);
  return visible ? <Widget native={false} /> : null;
}
