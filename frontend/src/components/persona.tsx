import { useEffect, useState } from "react";
import { useFocusSession } from "../session/store";
import type { ResponseMode } from "./cloudMemory";

const key = "mobonyong.tone";
export type Tone = "default" | "hardcore";
const readTone = (): Tone => localStorage.getItem(key) === "hardcore" ? "hardcore" : "default";
export function useTone() {
  const [tone, set] = useState(readTone);
  useEffect(() => {
    const sync = () => set(readTone());
    window.addEventListener("storage", sync);
    window.addEventListener("mobonyong-tone", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("mobonyong-tone", sync); };
  }, []);
  return [tone, (next: Tone) => {
    localStorage.setItem(key, next);
    window.dispatchEvent(new Event("mobonyong-tone"));
  }] as const;
}
const lines = {
  default: {
    youtube: [["수능 사흘 남았다 치고, 이 영상이 시험 범위냐?", "재생 버튼은 눌렀고, 공부 시작 버튼은 장식이야?"],
      ["5분째 추천 알고리즘한테 진로 상담 받는 중이냐?", "연관 영상만 이어 보고 있네. 네 목표랑은 연관이 없고."],
      ["봉인 해제. 추천 영상의 굴레를 끊어라.", "최종 경고. 시험지는 추천 영상을 채점하지 않는다."]],
    inactivity: [["입력이 없네. 책 읽는 중이면 내가 틀린 거고.", "손이 멈췄군. 문제 푸는 중인가, 집중이 멈춘 건가?"],
      ["5분째 조용하다. 풀던 문제면 인정. 딴생각이면 돌아와.", "제법 오래 멈췄네. 종이 위에서 싸우는 중이면 말해."],
      ["정적의 봉인을 풀어라. 공부 중이면 이번엔 내가 물러난다.", "10분째 조용하군. 아직 목표가 살아 있는지 확인한다."]],
    return: ["돌아왔네. 기다린 건 아니고, 다음 줄이나 펴.", "그래, 그거부터 해. 응원은 한 번만 한다."],
    study: ["내가 헛짚었군. 자, 이 얘긴 여기까지.", "공부 중이었어? 인정. 더 방해 안 할게."],
  },
  hardcore: {
    youtube: [["젠장, 그 추천 영상이 수능 문제로 나오냐?", "추천 영상에 인생 맡겼냐? 네 목표부터 봐."],
      ["빌어먹을 자동 재생. 5분째 네 계획을 잡아먹고 있잖아.", "씨발, 자동 재생이 수능 대신 봐 주냐? 5분째다."],
      ["빌어먹을 추천의 봉인, 지금 해제한다.", "최종 심판이다. 젠장, 답안지는 네가 써야 해."]],
    inactivity: [["젠장, 너무 조용해서 헷갈리네. 책 보는 중이야?", "키보드가 잠들었군. 공부 중이면 그렇다고 해."],
      ["5분째 정적이네. 공부 중이면 인정, 딴생각이면 이 빌어먹을 정적을 깨.", "제법 긴 정적이다. 문제랑 싸우는 중이면 내가 빠질게."],
      ["젠장, 10분의 정적. 집중의 봉인이 맞는지 직접 답해.", "암흑의 정적을 관측했다. 공부 중이면 내 판단이 빗나간 거다."]],
    return: ["젠장, 돌아오긴 했네. 됐다. 다음 줄이나 읽어.", "빌어먹을 우회로 끝. 이제 그 문제부터 해."],
    study: ["젠장, 내가 헛짚었다. 너 하던 거 해.", "내 판단이 삐끗했군. 인정한다. 됐지?"],
  },
};
export function interventionLine(tone: Tone, source: "youtube" | "inactivity", stage: number, seed: number) {
  const variants = lines[tone][source][Math.min(3, Math.max(1, stage)) - 1];
  return variants[seed % variants.length];
}

type Reply = { taskId: number; mode: ResponseMode; at: number };
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("mobonyong.replies") : null;
const eventName = "mobonyong-reply";
export function announceReply(taskId: number | undefined, mode: ResponseMode) {
  if (taskId === undefined) return;
  const reply: Reply = { taskId, mode, at: Date.now() };
  channel?.postMessage(reply);
  window.dispatchEvent(new CustomEvent(eventName, { detail: reply }));
}
export function useReply() {
  const { session } = useFocusSession();
  const [reply, setReply] = useState<Reply | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const set = (value: Reply) => {
      clearTimeout(timer);
      setReply(value);
      timer = setTimeout(() => setReply(null), 6000);
    };
    const local = (event: Event) => set((event as CustomEvent<Reply>).detail);
    const remote = (event: MessageEvent<Reply>) => set(event.data);
    window.addEventListener(eventName, local);
    channel?.addEventListener("message", remote);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(eventName, local);
      channel?.removeEventListener("message", remote);
    };
  }, []);
  return session.running && !session.paused && reply && reply.taskId === session.task?.id ? reply : null;
}
export function ReplyNotice({ mode, task }: { mode: ResponseMode; task: string }) {
  const [tone] = useTone();
  return <p className="focus-reply" role="status">{lines[tone][mode][task.length % 2]}<br /><strong>{task}</strong></p>;
}
export function ResponseButtons({ busy, answer }: { busy: boolean; answer: (mode: ResponseMode) => void }) {
  return <div className="cloud-question-actions">
    <button disabled={busy} onClick={() => answer("return")}>돌아갈게...</button>
    <button className="ghost" disabled={busy} onClick={() => answer("study")}>공부 중인데?</button>
  </div>;
}
