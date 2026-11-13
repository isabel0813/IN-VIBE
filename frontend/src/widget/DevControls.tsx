import { characterStates } from "../session/model";
import { sessionStore, useFocusSession } from "../session/store";
import { characterCopy } from "./character";
import { showWidget } from "../desktop/bridge";
import { useState } from "react";

export default function DevControls() {
  const { session, ready } = useFocusSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="pet-dev-controls">
      <summary>개발 전용 · 안뇽이 상태 테스트</summary>
      <p>
        실제 활동 감지나 측정 시간 없이 표정과 대사만 바꿉니다. 확인 응답은
        작업을 시작한 뒤 테스트하세요.
      </p>
      <div>
        {characterStates.map((character) => (
          <button
            key={character}
            disabled={busy || !ready}
            aria-pressed={session.character === character}
            onClick={() => {
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  await sessionStore.send({ type: "character", character });
                  await showWidget();
                } catch (failure) {
                  setError(String(failure));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {character} · {characterCopy[character].label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
