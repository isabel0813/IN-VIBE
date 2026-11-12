const toggle = document.querySelector('#enabled');
async function refresh(message = { type: "status" }) {
  try {
    const state = await chrome.runtime.sendMessage(message);
    toggle.checked = state.enabled;
    document.querySelector('#status').textContent = !state.enabled ? "확장 기능 꺼짐" : !state.connected ? "앱 연결 대기 · 앱 실행과 Native Host 등록을 확인하세요" : state.collecting ? "앱 연결됨 · 집중 세션 관측 중" : "앱 연결됨 · 앱 동의 또는 세션 시작 대기";
    document.querySelector('#extension-id').textContent = state.extensionId;
  } catch { document.querySelector('#status').textContent = "확장 프로그램을 다시 로드해 주세요."; }
}
toggle.addEventListener('change', () => void refresh({ type: 'enable', enabled: toggle.checked }));
void refresh(); setInterval(() => void refresh(), 1500);
