!macro customCheckAppRunning
  InitPluginsDir
  !ifdef BUILD_UNINSTALLER
    CopyFiles /SILENT "$INSTDIR\resources\screensh-install-processes.ps1" "$PLUGINSDIR\screensh-install-processes.ps1"
  !else
    File /oname=$PLUGINSDIR\screensh-install-processes.ps1 "${BUILD_RESOURCES_DIR}\..\res\screensh-install-processes.ps1"
  !endif
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\screensh-install-processes.ps1" -InstallRoot "$INSTDIR" -InstallerPid $0'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please close ScreenSh and retry. Application data has been preserved." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customRemoveFiles
  # Preserve mutable data on both update and uninstall.
  SetOutPath $TEMP
  CreateDirectory "$INSTDIR\data"
  # Stage old application files on the SAME volume for atomic renames.
  GetTempFileName $3 "$INSTDIR\data"
  Delete "$3"
  CreateDirectory "$3"
  FindFirst $0 $1 "$INSTDIR\*.*"
  screensh_remove_loop:
    StrCmp $1 "" screensh_remove_done
    StrCmp $1 "." screensh_remove_next
    StrCmp $1 ".." screensh_remove_next
    StrCmp $1 "data" screensh_remove_next
    ClearErrors
    Rename "$INSTDIR\$1" "$3\$1"
    StrCmp $1 "${UNINSTALL_FILENAME}" screensh_remove_next
    IfErrors screensh_remove_failed screensh_remove_next
  screensh_remove_next:
    FindNext $0 $1
    Goto screensh_remove_loop
  screensh_remove_failed:
    FindClose $0
    FindFirst $4 $5 "$3\*.*"
  screensh_restore_loop:
    StrCmp $5 "" screensh_restore_done
    StrCmp $5 "." screensh_restore_next
    StrCmp $5 ".." screensh_restore_next
    Rename "$3\$5" "$INSTDIR\$5"
  screensh_restore_next:
    FindNext $4 $5
    Goto screensh_restore_loop
  screensh_restore_done:
    FindClose $4
    # Nonrecursive: retain any files that could not be restored.
    RMDir "$3"
    Abort "Application files are in use. Close ScreenSh and retry; data has been preserved."
  screensh_remove_done:
    FindClose $0
    RMDir /r "$3"
    # Nonrecursive: the user's data remains after uninstall.
    RMDir "$INSTDIR"
!macroend
