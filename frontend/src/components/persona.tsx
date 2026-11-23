import { useEffect, useState } from "react";
import { useFocusSession } from "../session/store";
import type { Incident } from "../activity/bridge";
import { cloudMemory, type ResponseMode } from "./cloudMemory";
import { dialogueContext, dialogueStage, renderDialogue, type DialogueContext, type DialogueRequest, type DialogueSelection } from "./dialogue";
import type { DialogueGroup, Tone } from "./personaLines";

const key = "mobonyong.tone";
export type { Tone } from "./personaLines";
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
type LineProps = DialogueContext & { eventId: string; group: DialogueGroup; stage?: number; as?: "strong" | "span" | "h1" };
export function DialogueLine({ eventId, group, stage, task, video, as: Element = "strong" }: LineProps) {
  const [tone] = useTone();
  const level = group === "inactivity" && stage === 0 ? 0 : dialogueStage(stage);
  const context = dialogueContext(tone, { task, video });
  const hasTask = !!context.task, hasVideo = !!context.video;
  const key = `${tone}:${group}:${eventId}`;
  const [line, setLine] = useState<{ key: string; selection: DialogueSelection }>();
  useEffect(() => {
    let current = true;
    const selection = cloudMemory.dialogue({ id: eventId, tone, group, stage: level, hasTask, hasVideo });
    if (selection instanceof Promise) void selection.then(value => { if (current) setLine({ key, selection: value }); });
    else setLine({ key, selection });
    return () => { current = false; };
  }, [eventId, tone, group, level, hasTask, hasVideo, key]);
  const request: DialogueRequest = { id: eventId, tone, group, stage: level, hasTask, hasVideo };
  const active = line?.key === key && (!level || line.selection.stage === level) ? line.selection : undefined;
  return <Element className="persona-line" data-dialogue-stage={active?.stage ?? level}>
    {active ? renderDialogue(active, request, context) : null}
  </Element>;
}

export function InactivityDialogue({ incident, task, as }: { incident: Incident; task?: string; as?: LineProps["as"] }) {
  return <DialogueLine eventId={`inactivity:${incident.id}:${incident.startedAt}`}
    group="inactivity" stage={incident.stage} task={task} as={as} />;
}

type Reply = { id: string; taskId: number; mode: ResponseMode };
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("mobonyong.replies") : null;
const eventName = "mobonyong-reply";
export function announceReply(taskId: number | undefined, mode: ResponseMode) {
  if (taskId === undefined) return;
  const reply: Reply = { id: crypto.randomUUID(), taskId, mode };
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
export function ReplyNotice({ reply, task }: { reply: Reply; task: string }) {
  return <p className="focus-reply" role="status" aria-label={reply.mode === "study" ? "오탐 정정 안내" : "집중 복귀 안내"}>
    <DialogueLine eventId={reply.id} group={reply.mode} task={task} as="span" /><br /><strong>{task}</strong>
  </p>;
}
export function ResponseButtons({ busy, answer }: { busy: boolean; answer: (mode: ResponseMode) => void }) {
  return <div className="cloud-question-actions">
    <button disabled={busy} onClick={() => answer("return")}>돌아갈게...</button>
    <button className="ghost" disabled={busy} onClick={() => answer("study")}>공부 중인데?</button>
  </div>;
}
