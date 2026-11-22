!define MOBONYONG_HOST_KEY "Software\Google\Chrome\NativeMessagingHosts\io.invibe.annyong.youtube"
!define MOBONYONG_BACKUP_KEY "Software\Mobonyong\TesterBeta\NativeHost"
!define MOBONYONG_MANIFEST "$INSTDIR\beta-host\io.invibe.annyong.youtube.json"

!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ExecWait '"$INSTDIR\beta-host\in-vibe-native-host.exe" --write-beta-manifest' $0
  IfErrors beta_host_fail
  StrCmp $0 "0" 0 beta_host_fail
  ReadRegStr $0 HKCU "${MOBONYONG_HOST_KEY}" ""
  StrCmp $0 "${MOBONYONG_MANIFEST}" beta_host_done
  ClearErrors
  WriteRegStr HKCU "${MOBONYONG_BACKUP_KEY}" "PreviousManifest" "$0"
  IfErrors beta_host_fail
  WriteRegStr HKCU "${MOBONYONG_HOST_KEY}" "" "${MOBONYONG_MANIFEST}"
  IfErrors beta_host_fail
  ReadRegStr $1 HKCU "${MOBONYONG_HOST_KEY}" ""
  StrCmp $1 "${MOBONYONG_MANIFEST}" beta_host_done
  beta_host_fail:
    MessageBox MB_OK|MB_ICONSTOP "Could not finish Mobonyong's Chrome connection. See CONNECTION-KO.html."
    Abort
  beta_host_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $0 HKCU "${MOBONYONG_HOST_KEY}" ""
  StrCmp $0 "${MOBONYONG_MANIFEST}" 0 beta_host_cleanup
  ReadRegStr $1 HKCU "${MOBONYONG_BACKUP_KEY}" "PreviousManifest"
  StrCmp $1 "" beta_host_remove
  IfFileExists "$1" 0 beta_host_remove
  WriteRegStr HKCU "${MOBONYONG_HOST_KEY}" "" "$1"
  Goto beta_host_cleanup
  beta_host_remove:
    DeleteRegValue HKCU "${MOBONYONG_HOST_KEY}" ""
    DeleteRegKey /ifempty HKCU "${MOBONYONG_HOST_KEY}"
  beta_host_cleanup:
    DeleteRegValue HKCU "${MOBONYONG_BACKUP_KEY}" "PreviousManifest"
    DeleteRegKey /ifempty HKCU "${MOBONYONG_BACKUP_KEY}"
    Delete "${MOBONYONG_MANIFEST}"
!macroend
