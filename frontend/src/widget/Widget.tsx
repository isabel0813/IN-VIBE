import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import {
  closedLayout,
  concealWidget,
  isDesktop,
  nativeWidget,
  showMain,
} from "../desktop/bridge";
import type { WidgetLayout } from "../desktop/bridge";
import { sessionStore, useFocusSession } from "../session/store";
import type { SessionAction } from "../session/model";
import { characterArt, characterCopy } from "./character";
import { previewPlacement } from "./geometry";
import "./widget.css";
import { activityApi, useActivity } from "../activity/bridge";
import RecoveryFlow from "../activity/RecoveryFlow";
import { CloudQuestion, useCloudSession } from "../components/CloudSession";

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
  const copy = characterCopy[cloud?.ask ? "suspect" : session.character];
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
    async (open: boolean) => {
      try {
        if (native) await nativeWidget.bubble(open);
        else setLayout((value) => ({ ...value, open }));
      } catch (failure) {
        setError(`말풍선을 바꾸지 못했어요. ${String(failure)}`);
      }
    },
    [native],
  );

  useEffect(() => {
    if (!layout.open) return;
    dialog.current?.focus({ preventScroll: true });
    const outside = (event: globalThis.PointerEvent) => {
      if (
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
    if (!native) window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [layout.open, native, bubble]);

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
  const above = geometry.petY > (geometry.height - 80) / 2;

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
          className={`pet-bubble ${above ? "above" : "below"}`}
          style={{
            left: 8,
            right: 8,
            ...(above
              ? { bottom: geometry.height - geometry.petY + 8 }
              : { top: geometry.petY + 88 }),
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
          <p className="pet-line">
            {session.paused && !session.simulated
              ? "잠깐 쉬어라. 돌아오면 다시 가자."
              : copy.line}
          </p>
          <p className="pet-current-task">
            <span>현재 작업</span>
            <strong>{session.task?.name ?? "아직 고른 일이 없네."}</strong>
          </p>
          {session.simulated && (
            <p className="pet-simulation">
              개발 시뮬레이션 · 실제 활동 감지 없음
            </p>
          )}
          <RecoveryFlow incident={activity.incident} paused={session.paused || !session.running} />
          <CloudQuestion />
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
          <div className="pet-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await showMain("plan");
                  await bubble(false);
                })
              }
            >
              계획 보기 ↗
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await showMain("input");
                  await bubble(false);
                })
              }
            >
              할 일 추가하기 ＋
            </button>
          </div>
          <div className="pet-session-actions">
            {activity.consent && <button disabled={busy} onClick={() => void run(async () => {
              await activityApi.configure({ consent: false, thresholdSeconds: activity.thresholdSeconds, relatedTerms: activity.relatedTerms, suspectTerms: activity.suspectTerms });
            })}>활동 감지 중지</button>}
            <button
              disabled={busy || !session.running}
              onClick={() =>
                send({ type: session.paused ? "resume" : "pause" })
              }
            >
              {session.paused ? "집중 세션 재개" : "집중 세션 일시정지"}
            </button>
            <button
              disabled={busy || !session.running}
              onClick={() =>
                void run(async () => {
                  await sessionStore.send({ type: "end" });
                  await showMain("plan");
                  await bubble(false);
                })
              }
            >
              집중 세션 종료
            </button>
          </div>
          {(error || syncError) && (
            <p className="pet-error" role="alert">
              {error || syncError}
              <button onClick={() => void sessionStore.sync()}>
                다시 동기화
              </button>
            </p>
          )}
          <div className="pet-window-actions">
            <span>
              {native ? "조용히 곁에 있을게." : "웹 미리보기 · OS 창 제어 없음"}
            </span>
            <button
              disabled={busy}
              onClick={() => void run(() => concealWidget(true))}
            >
              최소화
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => concealWidget(false))}
            >
              숨김
            </button>
          </div>
        </div>
      )}
      <button
        ref={pet}
        className={`pet-character state-${cloud?.ask ? "suspect" : session.character}`}
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
          if (!layout.open && activity.incident && !activity.incident.claimed) {
            const id = activity.incident.id;
            void run(async () => {
              await activityApi.respond(id, "review");
              await bubble(true);
            });
          } else void bubble(!layout.open);
        }}
      >
        <img draggable={false} src={characterArt[session.character]} alt="" />
        <span className="pet-state-dot" aria-hidden="true" />
        {!layout.open && !session.paused && (cloud?.ask || (session.character === "suspect" && activity.incident)) && <span className="pet-nudge">잠깐, 확인!</span>}
      </button>
      {native && !layout.open && <div
        className="pet-drag-handle"
        title="안뇽이 이동 · 이 손잡이를 드래그하세요"
        aria-label="안뇽이 이동 손잡이"
        style={{ left: geometry.petX + 28, top: geometry.petY + 70 }}
        onPointerDown={(event) => {
          if (event.button === 0) void run(() => nativeWidget.drag());
        }}
      >···</div>}
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
