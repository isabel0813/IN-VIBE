import { useRef, useState } from "react";
import { announceReply, InactivityDialogue, ResponseButtons } from "../components/persona";
import type { ResponseMode } from "../components/cloudMemory";
import { useFocusSession } from "../session/store";
import { activityApi } from "./bridge";
import type { Incident } from "./bridge";

export default function InactivityQuestion({ incident, fullscreen = false }: { incident: Incident; fullscreen?: boolean }) {
  const { session } = useFocusSession();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function answer(mode: ResponseMode) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await activityApi.respond(incident.id, mode === "study" ? "studying" : "return");
      announceReply(session.task?.id, mode);
    } catch (failure) {
      setError(String(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <section className="cloud-question" role="status" aria-label="무입력 확인">
    {!fullscreen && <InactivityDialogue incident={incident} task={session.task?.name} />}
    <p>키보드와 마우스 입력이 없었어. 지금 상태를 알려 줘.</p>
    <ResponseButtons busy={busy} answer={mode => void answer(mode)} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
