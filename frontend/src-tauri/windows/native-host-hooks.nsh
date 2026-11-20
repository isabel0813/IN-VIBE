; Paths are captured at include time; inside hook macros __FILEDIR__ changes.
!define MOBONYONG_HOST_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\mobonyong-native-host\scripts"
  File "${MOBONYONG_HOST_HOOK_DIR}\native-host-payload\scripts\Auto-Register-Host.ps1"
  File "${MOBONYONG_HOST_HOOK_DIR}\native-host-payload\scripts\Configure-DownloadedHost.ps1"
  File "${MOBONYONG_HOST_HOOK_DIR}\native-host-payload\scripts\Register-NativeHost.ps1"
  SetOutPath "$PLUGINSDIR\mobonyong-native-host\native-host-runtime"
  File "${MOBONYONG_HOST_HOOK_DIR}\native-host-payload\native-host-runtime\in-vibe-native-host.exe"
  File "${MOBONYONG_HOST_HOOK_DIR}\native-host-payload\native-host-runtime\HOST-BUILD.json"
  SetOutPath "$INSTDIR"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\mobonyong-native-host\scripts\Auto-Register-Host.ps1"'
  Pop $0
  Pop $1
  DetailPrint "$1"
  DetailPrint "Mobonyong Native Host logs: $LOCALAPPDATA\Mobonyong\NativeHost\logs"
  StrCmp $0 "0" mobonyong_host_ok
    DetailPrint "Mobonyong Native Host automatic registration failed (exit $0)."
    MessageBox MB_OK|MB_ICONEXCLAMATION "Mobonyong installed, but YouTube connection setup did not finish. See the installer details and Native Host setup guide." /SD IDOK
  mobonyong_host_ok:
  Pop $1
  Pop $0
!macroend
