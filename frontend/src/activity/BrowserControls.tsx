import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isDesktop } from "../desktop/bridge";
interface Connection { consent: boolean; connected: boolean; collecting: boolean; observing: boolean; error: string | null }
export default function BrowserControls({ activityConsent }: { activityConsent: boolean }) {
  const [value, setValue] = useState<Connection>({ consent: false, connected: false, collecting: false, observing: false, error: null });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let alive = true;
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      try { const next = await invoke<Connection>("browser_read"); if (alive) { setValue(next); setError(""); } }
      catch (failure) { if (alive) setError(String(failure)); }
      finally { reading = false; }
    }
    void read(); const timer = setInterval(() => void read(), 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function toggle(consent: boolean) {
    setBusy(true);
    try { setValue(await invoke<Connection>("browser_configure", { consent })); setError(""); }
    catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  return <section className="browser-controls" aria-label="YouTube 연결">
    <strong>YouTube 확장 프로그램 · {value.connected ? "연결됨" : "연결 안 됨"}</strong>
    <p>선택한 YouTube 영상의 제목·ID·재생 상태만 이 PC에서 작업명과 비교해요. 제목과 활동 기록은 서버로 보내지 않아요. 확장 프로그램에서도 관측을 켜야 해요.</p>
    <label><input type="checkbox" disabled={busy || (!activityConsent && !value.consent)} checked={value.consent} onChange={e => void toggle(e.target.checked)} /> YouTube 영상 정보의 로컬 관측에 동의합니다</label>
    <p>{value.observing ? "활성 Chrome 영상 재생 관측 중 · 분류는 추정이에요" : value.collecting ? "영상 대기 · 관측할 수 없으면 미분류" : "관측 중지 · 동의한 집중 세션에서만 시작해요"}</p>
    {(error || value.error) && <p role="alert">{error || value.error}</p>}
  </section>;
}
