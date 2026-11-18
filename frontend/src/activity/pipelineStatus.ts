type Session = { running: boolean; paused: boolean; task: { id: number } | null };
type Browser = { consent: boolean; connected: boolean; collecting: boolean; observing: boolean };

export function activityStatus(consent: boolean, monitoring: boolean, category: string, session: Session, ready: boolean) {
  if (!consent) return "꺼짐";
  if (!ready) return "세션 상태 확인 중";
  if (!session.running) return "세션 대기";
  if (session.paused) return "일시정지";
  // Cloud sessions deliberately stop the local detector; this is not a missing session.
  if (session.task && session.task.id >= 1_000_000_000_000) return "한 줄 세션 · 로컬 이탈 판단 제외";
  return monitoring ? category : "관측 상태 확인 중";
}

export function browserStatus(activityConsent: boolean, browser: Browser, session: Session, ready: boolean) {
  if (!activityConsent) return "관측 중지 · Windows 활동 감지 동의가 필요해요";
  if (!browser.consent) return "관측 중지 · YouTube 로컬 관측 동의가 필요해요";
  if (!ready) return "세션 상태 확인 중";
  if (!session.running) return "관측 중지 · 집중 세션 시작 대기";
  if (session.paused) return "관측 중지 · 세션 일시정지";
  if (!browser.connected) return "관측 중지 · Native Host 연결 대기. 확장 ID·등록 경로·버전을 확인해 주세요";
  if (!browser.collecting) return "수집 준비 확인 필요 · 실행 중인 앱과 Host의 버전을 확인해 주세요";
  return browser.observing ? "표시 중인 Chrome 영상 재생 관측 중 · 창의 노출 면적을 추정해요" : "영상 대기 · 선택된 탭의 재생·가시성·확장 버전을 확인해 주세요";
}
