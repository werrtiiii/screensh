!ifdef VERSION
  !include "${__FILEDIR__}\installer-ui.nsh"
!endif

!ifndef BUILD_UNINSTALLER
  Var screenshSetupTransaction
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    # Old clients launch setup from data/updates and pass data/temp as TEMP.
    # Restart outside the install root before invoking their old uninstaller.
    ${GetParameters} $R6
    ClearErrors
    ${GetOptions} $R6 "--screensh-staged" $R7
    ${If} ${Errors}
      # $LOCALAPPDATA follows SetShellVarContext and becomes ProgramData in an
      # all-users install. Resolve the process user's local profile explicitly,
      # matching Environment.SpecialFolder.LocalApplicationData in the helper.
      System::Call 'shell32::SHGetFolderPathW(p 0, i 0x1c, p 0, i 0, w .r9)i.r0'
      ${If} $0 != 0
      ${OrIf} $9 == ""
        MessageBox MB_OK|MB_ICONSTOP "Cannot locate the current user's temporary directory." /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      CreateDirectory "$9\Temp"
      System::Call 'kernel32::GetCurrentProcessId()i.r0'
      StrCpy $R8 "$9\Temp\ScreenSh-bootstrap-$0.tmp"
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
  !ifndef BUILD_UNINSTALLER
    # Fallback handoff does not use the independent updater. The NSIS installer
    # itself signals readiness, then waits before it may stop the old client.
    ${GetParameters} $R6
    ClearErrors
    ${GetOptions} $R6 "--screensh-wait-parent=" $R7
    ${IfNot} ${Errors}
      IfFileExists "$EXEDIR\fallback.cancel" 0 +3
        SetErrorLevel 2
        Quit
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $R7)p.r8'
      ${If} $8 == 0
        SetErrorLevel 2
        Quit
      ${EndIf}
      ClearErrors
      FileOpen $R9 "$EXEDIR\fallback.ready" w
      ${If} ${Errors}
        System::Call 'kernel32::CloseHandle(p r8)'
        SetErrorLevel 2
        Quit
      ${EndIf}
      FileWrite $R9 "ready"
      FileClose $R9
      StrCpy $R5 0
      screensh_parent_wait:
        IfFileExists "$EXEDIR\fallback.cancel" screensh_parent_cancel
        System::Call 'kernel32::WaitForSingleObject(p r8, i 100)i.r7'
        IntCmp $7 0 screensh_parent_done
        IntCmp $7 258 0 screensh_parent_cancel screensh_parent_cancel
        IntOp $R5 $R5 + 1
        IntCmp $R5 900 screensh_parent_cancel screensh_parent_wait screensh_parent_cancel
      screensh_parent_cancel:
        StrCpy $7 1
      screensh_parent_done:
      System::Call 'kernel32::CloseHandle(p r8)'
      IfFileExists "$EXEDIR\fallback.cancel" 0 +2
        StrCpy $7 1
      ${If} $7 != 0
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  !endif
!macroend

!macro screenshReadInstallerDetail
  # nsExec decodes console output using the system code page. Read the native
  # helper's UTF-16 report instead, including on non-Chinese Windows systems.
  StrCpy $1 "检查程序未能提供详细信息。"
  ClearErrors
  FileOpen $R9 "$PLUGINSDIR\installer-detail.txt" r
  ${IfNot} ${Errors}
    FileReadUTF16LE $R9 $1
    FileClose $R9
  ${EndIf}
!macroend

!macro screenshWriteInstallerLog STAGE
  FileSeek $R9 0 END $R8
  ${If} $R8 == 0
    FileWriteWord $R9 0xFEFF
  ${EndIf}
  FileWriteUTF16LE $R9 "${STAGE}: code=$0; detail=$1$\r$\n"
!macroend

!macro customCheckAppRunning
  # Validate before running helpers or writing anything beneath the target.
  ${If} $INSTDIR == ""
    MessageBox MB_OK|MB_ICONSTOP "安装目录无效，请重新选择安装位置。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  System::Call 'shlwapi::PathIsRelativeW(w "$INSTDIR")i.r0'
  System::Call 'shlwapi::PathIsRootW(w "$INSTDIR")i.r1'
  ${If} $0 != 0
  ${OrIf} $1 != 0
    MessageBox MB_OK|MB_ICONSTOP "安装目录无效，请重新选择安装位置。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  InitPluginsDir
  !ifdef BUILD_UNINSTALLER
    CopyFiles /SILENT "$INSTDIR\resources\screensh-platform.exe" "$PLUGINSDIR\screensh-platform.exe"
  !else
    File /oname=$PLUGINSDIR\screensh-platform.exe "${BUILD_RESOURCES_DIR}\..\res\screensh-platform.exe"
  !endif
  System::Call 'kernel32::GetCurrentProcessId()i.r0'
  Delete "$PLUGINSDIR\installer-detail.txt"
  nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" stop-installed "$INSTDIR" $0 apply --installer-report "$PLUGINSDIR\installer-detail.txt"'
  Pop $0
  Pop $1
  !insertmacro screenshReadInstallerDetail
  CreateDirectory "$INSTDIR\data\logs"
  ClearErrors
  FileOpen $R9 "$INSTDIR\data\logs\installer-check.log" a
  ${IfNot} ${Errors}
    !insertmacro screenshWriteInstallerLog "stop-installed"
    FileClose $R9
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装前检查未通过（返回码 $0）。$\r$\n$1$\r$\n$\r$\n个人数据已保留。$\r$\n日志：$INSTDIR\data\logs\installer-check.log" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  !ifndef BUILD_UNINSTALLER
    # Replace the legacy uninstaller before electron-builder invokes it. This
    # prevents an older installation from reintroducing script dependencies.
    File /oname=$PLUGINSDIR\native-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
    !ifdef VERSION
      File /oname=$PLUGINSDIR\screensh-updater.exe "${BUILD_RESOURCES_DIR}\..\res\screensh-updater.exe"
      System::Call 'kernel32::GetCurrentProcessId()i.r0'
      nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" prepare-setup "$INSTDIR" "${VERSION}" $0 "$PLUGINSDIR\screensh-updater.exe" "${INSTALL_REGISTRY_KEY}" "${UNINSTALL_REGISTRY_KEY}" "$PLUGINSDIR\native-uninstaller.exe" --installer-report "$PLUGINSDIR\installer-detail.txt"'
      Pop $0
      Pop $1
      !insertmacro screenshReadInstallerDetail
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "无法备份旧版本，安装已停止。$\r$\n$1" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      StrCpy $screenshSetupTransaction $1
    !else
    ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R2 == ""
      ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    ${If} $R2 != ""
      Delete "$PLUGINSDIR\installer-detail.txt"
      nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" prepare-upgrade "$R2" "$PLUGINSDIR\native-uninstaller.exe" --installer-report "$PLUGINSDIR\installer-detail.txt"'
      Pop $0
      Pop $1
      !insertmacro screenshReadInstallerDetail
      ClearErrors
      FileOpen $R9 "$INSTDIR\data\logs\installer-check.log" a
      ${IfNot} ${Errors}
        !insertmacro screenshWriteInstallerLog "prepare-upgrade"
        FileClose $R9
      ${EndIf}
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "准备覆盖升级时失败（返回码 $0）。$\r$\n$1$\r$\n$\r$\n个人数据已保留。$\r$\n日志：$INSTDIR\data\logs\installer-check.log" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
    !endif
  !endif
!macroend

!macro customInstall
  ${If} $screenshSetupTransaction != ""
    nsExec::ExecToStack '"$PLUGINSDIR\screensh-platform.exe" complete-setup "$screenshSetupTransaction"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      SetErrorLevel 2
      Quit
    ${EndIf}
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
