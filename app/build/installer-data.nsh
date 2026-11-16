!ifdef VERSION
  !include "${__FILEDIR__}\installer-ui.nsh"
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    # Old clients launch setup from data/updates and pass data/temp as TEMP.
    # Restart outside the install root before invoking their old uninstaller.
    ${GetParameters} $R6
    ClearErrors
    ${GetOptions} $R6 "--screensh-staged" $R7
    ${If} ${Errors}
      CreateDirectory "$LOCALAPPDATA\Temp"
      System::Call 'kernel32::GetCurrentProcessId()i.r0'
      StrCpy $R8 "$LOCALAPPDATA\Temp\ScreenSh-bootstrap-$0.tmp"
      CreateDirectory "$R8"
      ClearErrors
      CopyFiles /SILENT "$EXEPATH" "$R8\setup.exe"
      IfErrors 0 +3
        SetErrorLevel 2
        Quit
      File /oname=$R8\updater.exe "${BUILD_RESOURCES_DIR}\..\res\screensh-updater.exe"
      StrCpy $R5 "false"
      StrCpy $R4 "false"
      StrCpy $R3 "false"
      ${If} ${Silent}
        StrCpy $R5 "true"
      ${EndIf}
      ClearErrors
      ${GetOptions} $R6 "--updated" $R7
      ${IfNot} ${Errors}
        StrCpy $R4 "true"
      ${EndIf}
      ClearErrors
      ${GetOptions} $R6 "--force-run" $R7
      ${IfNot} ${Errors}
        StrCpy $R3 "true"
      ${EndIf}
      ClearErrors
      Exec '"$R8\updater.exe" --bootstrap "$R8" "$INSTDIR" $0 $R5 $R4 $R3'
      ${If} ${Errors}
        SetErrorLevel 2
        Quit
      ${EndIf}
      SetErrorLevel 0
      Quit
    ${EndIf}
  !endif
!macroend

!macro customCheckAppRunning
  InitPluginsDir
  !ifdef BUILD_UNINSTALLER
    CopyFiles /SILENT "$INSTDIR\resources\screensh-platform.exe" "$PLUGINSDIR\screensh-platform.exe"
  !else
    File /oname=$PLUGINSDIR\screensh-platform.exe "${BUILD_RESOURCES_DIR}\..\res\screensh-platform.exe"
  !endif
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" stop-installed "$INSTDIR" $0 apply'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please close ScreenSh and retry. Application data has been preserved." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  !ifndef BUILD_UNINSTALLER
    # Replace the legacy uninstaller before electron-builder invokes it. This
    # prevents an older installation from reintroducing script dependencies.
    File /oname=$PLUGINSDIR\native-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
    ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R2 != ""
      nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" prepare-upgrade "$R2" "$PLUGINSDIR\native-uninstaller.exe"'
      Pop $0
      Pop $1
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot prepare ScreenSh upgrade; data has been preserved." /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  !endif
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
