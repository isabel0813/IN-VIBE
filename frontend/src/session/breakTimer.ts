import { useEffect, useState } from "react";
import { sessionStore, useFocusSession } from "./store";

/**
 * 일시정지 "쉬는 시간". 위젯에서 정하고, 메인 창(항상 살아 있는 창)이 시간이 되면 재개한다.
 * 개인정보가 없는 시각 값만 저장한다.
 */
const KEY = "mobonyong.break-until";
export const BREAK_MIN = 5;
export const BREAK_MAX = 60;
export const BREAK_STEP = 5;

export function readBreakUntil(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}
export function setBreakUntil(at: number | null) {
  try {
    if (at) localStorage.setItem(KEY, String(at));
    else localStorage.removeItem(KEY);
  } catch { /* 저장 못 해도 일시정지는 된다 (자동 재개만 안 됨) */ }
  window.dispatchEvent(new Event(KEY));
}

/** 남은 쉬는 시간(ms). 쉬는 중이 아니면 null. 1초마다 갱신된다. */
export function useBreakRemaining(): number | null {
  const [now, setNow] = useState(() => Date.now());
  const [until, setUntil] = useState(readBreakUntil);
  useEffect(() => {
    const update = () => setUntil(readBreakUntil());
    const timer = setInterval(() => { setNow(Date.now()); update(); }, 1000);
    window.addEventListener("storage", update);
    window.addEventListener(KEY, update);
    return () => { clearInterval(timer); window.removeEventListener("storage", update); window.removeEventListener(KEY, update); };
  }, []);
  return until ? Math.max(0, until - now) : null;
}

/** 메인 창에서 한 번만 쓴다: 쉬는 시간이 끝나면 세션을 재개한다. */
export function useAutoResume() {
  const { session } = useFocusSession();
  useEffect(() => {
    const check = () => {
      const until = readBreakUntil();
      if (!until) return;
      const current = sessionStore.getSnapshot().session;
      if (!current.running || !current.paused) { setBreakUntil(null); return; }
      if (Date.now() >= until) {
        setBreakUntil(null);
        void sessionStore.send({ type: "resume" }).catch(() => {});
      }
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [session.running, session.paused]);
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return m > 0 ? `${m}분 ${String(s).padStart(2, "0")}초` : `${s}초`;
}
