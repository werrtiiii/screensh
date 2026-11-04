!ifndef BUILD_UNINSTALLER
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
SetFont "Microsoft YaHei UI" 9

!define MUI_BGCOLOR "FBFBFB"
!define MUI_TEXTCOLOR "242424"
!define MUI_INSTALLCOLORS "0F6CBD EDEDED"
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored smooth"
!define MUI_CUSTOMFUNCTION_GUIINIT ScreenShSetupInit

Var screenshPage
Var screenshTitle
Var screenshSubtitle
Var screenshPathLabel
Var screenshPath
Var screenshBrowse
Var screenshRun
Var screenshTitleFont
Var screenshBodyFont

LangString screenshWelcome 1033 "Install ScreenSh"
LangString screenshWelcome 2052 "安装 ScreenSh"
LangString screenshWelcome 1028 "安裝 ScreenSh"
LangString screenshIntro 1033 "Screen sharing and voice, together."
LangString screenshIntro 2052 "屏幕共享与语音交流，轻松连接。"
LangString screenshIntro 1028 "螢幕分享與語音交流，輕鬆連線。"
LangString screenshVersionText 1033 "Version ${VERSION}"
LangString screenshVersionText 2052 "版本 ${VERSION}"
LangString screenshVersionText 1028 "版本 ${VERSION}"
LangString screenshLocation 1033 "Installation folder"
LangString screenshLocation 2052 "安装位置"
LangString screenshLocation 1028 "安裝位置"
LangString screenshBrowseText 1033 "Browse..."
LangString screenshBrowseText 2052 "浏览…"
LangString screenshBrowseText 1028 "瀏覽…"
LangString screenshInstall 1033 "Install"
LangString screenshInstall 2052 "开始安装"
LangString screenshInstall 1028 "開始安裝"
LangString screenshInstalling 1033 "Installing ScreenSh"
LangString screenshInstalling 2052 "正在安装 ScreenSh"
LangString screenshInstalling 1028 "正在安裝 ScreenSh"
LangString screenshInstallingDetail 1033 "Please wait while ScreenSh is installed."
LangString screenshInstallingDetail 2052 "正在写入程序文件，请稍候…"
LangString screenshInstallingDetail 1028 "正在寫入程式檔案，請稍候…"
LangString screenshComplete 1033 "You're ready to go"
LangString screenshComplete 2052 "安装完成"
LangString screenshComplete 1028 "安裝完成"
LangString screenshCompleteDetail 1033 "ScreenSh has been installed. Click Finish to close setup."
LangString screenshCompleteDetail 2052 "ScreenSh 已准备就绪，点击完成退出安装向导。"
LangString screenshCompleteDetail 1028 "ScreenSh 已準備就緒，點擊完成退出安裝精靈。"
LangString screenshLaunch 1033 "Launch ScreenSh"
LangString screenshLaunch 2052 "立即启动 ScreenSh"
LangString screenshLaunch 1028 "立即啟動 ScreenSh"
LangString screenshFinish 1033 "Finish"
LangString screenshFinish 2052 "完成"
LangString screenshFinish 1028 "完成"
LangString screenshCancel 1033 "Cancel"
LangString screenshCancel 2052 "取消"
LangString screenshCancel 1028 "取消"
LangString screenshInvalidPath 1033 "Choose an absolute installation folder, not a drive root."
LangString screenshInvalidPath 2052 "请选择有效的绝对安装路径，不要使用磁盘根目录。"
LangString screenshInvalidPath 1028 "請選擇有效的絕對安裝路徑，不要使用磁碟根目錄。"

!macro customWelcomePage
  Page custom ScreenShSetupWelcome ScreenShSetupPathLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ScreenShSetupProgress
!macroend

!macro customFinishPage
  Page custom ScreenShSetupFinish ScreenShSetupFinishLeave
!macroend

!macro customHeader
  !insertmacro screenshSetupFunctions
!macroend

!macro screenshColor CONTROL LIGHTTEXT LIGHTBG
  ${If} ${CONTROL} != 0
  ${AndIf} ${CONTROL} != ""
    SetCtlColors ${CONTROL} ${LIGHTTEXT} ${LIGHTBG}
  ${EndIf}
!macroend

!macro screenshSetupFunctions
Function ScreenShSetupInit
  CreateFont $screenshTitleFont "Microsoft YaHei UI" 18 600
  CreateFont $screenshBodyFont "Microsoft YaHei UI" 10 400
  Call ScreenShSetupColors
FunctionEnd

Function ScreenShSetupColors
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 0, i 4)'
  !insertmacro screenshColor $HWNDPARENT 242424 FBFBFB
  !insertmacro screenshColor $screenshPage 242424 FBFBFB
  !insertmacro screenshColor $screenshTitle 242424 FBFBFB
  !insertmacro screenshColor $screenshSubtitle 6B6B6B FBFBFB
  !insertmacro screenshColor $screenshPathLabel 6B6B6B FBFBFB
  !insertmacro screenshColor $screenshPath 242424 FFFFFF
  !insertmacro screenshColor $screenshBrowse 242424 FFFFFF
  !insertmacro screenshColor $screenshRun 242424 FBFBFB
  GetDlgItem $0 $HWNDPARENT 1028
  !insertmacro screenshColor $0 6B6B6B FBFBFB
  GetDlgItem $0 $HWNDPARENT 1256
  !insertmacro screenshColor $0 6B6B6B FBFBFB
  GetDlgItem $0 $HWNDPARENT 1034
  !insertmacro screenshColor $0 242424 FBFBFB
  GetDlgItem $0 $HWNDPARENT 1037
  !insertmacro screenshColor $0 242424 FBFBFB
  GetDlgItem $0 $HWNDPARENT 1038
  !insertmacro screenshColor $0 6B6B6B FBFBFB
  GetDlgItem $0 $HWNDPARENT 1
  # Keep the primary button neutral; avoid the native blue default-button ring.
  SendMessage $HWNDPARENT 0x401 0 0
  SendMessage $0 0xF4 0 1
  GetDlgItem $0 $HWNDPARENT 2
  !insertmacro screenshColor $0 242424 FFFFFF
  System::Call 'user32::InvalidateRect(p $HWNDPARENT, p 0, i 1)'
FunctionEnd

Function ScreenShSetupResetControls
  StrCpy $screenshPage 0
  StrCpy $screenshTitle 0
  StrCpy $screenshSubtitle 0
  StrCpy $screenshPathLabel 0
  StrCpy $screenshPath 0
  StrCpy $screenshBrowse 0
  StrCpy $screenshRun 0
FunctionEnd

Function ScreenShSetupWelcome
  Call ScreenShSetupResetControls
  !insertmacro MUI_HEADER_TEXT "ScreenSh" "$(screenshVersionText)"
  nsDialogs::Create 1018
  Pop $screenshPage
  ${If} $screenshPage == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 12u 8u 275u 30u "$(screenshWelcome)"
  Pop $screenshTitle
  SendMessage $screenshTitle ${WM_SETFONT} $screenshTitleFont 1
  ${NSD_CreateLabel} 12u 36u 275u 18u "$(screenshIntro)"
  Pop $screenshSubtitle
  SendMessage $screenshSubtitle ${WM_SETFONT} $screenshBodyFont 1
  ${NSD_CreateLabel} 12u 61u 270u 12u "$(screenshLocation)"
  Pop $screenshPathLabel
  ${NSD_CreateDirRequest} 12u 78u 214u 13u "$INSTDIR"
  Pop $screenshPath
  SendMessage $screenshPath ${WM_SETFONT} $screenshBodyFont 1
  ${NSD_CreateBrowseButton} 232u 76u 55u 17u "$(screenshBrowseText)"
  Pop $screenshBrowse
  ${NSD_OnClick} $screenshBrowse ScreenShSetupBrowse
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "$(screenshInstall)"
  GetDlgItem $0 $HWNDPARENT 2
  ${NSD_SetText} $0 "$(screenshCancel)"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  Call ScreenShSetupColors
  SendMessage $HWNDPARENT 0x28 $screenshPath 1
  nsDialogs::Show
FunctionEnd

Function ScreenShSetupBrowse
  Pop $0
  nsDialogs::SelectFolderDialog "$(screenshLocation)" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    ${GetFileName} $0 $1
    ${If} $1 != "${PRODUCT_FILENAME}"
      StrCpy $0 "$0\${PRODUCT_FILENAME}"
    ${EndIf}
    ${NSD_SetText} $screenshPath $0
  ${EndIf}
FunctionEnd

Function ScreenShSetupPathLeave
  ${NSD_GetText} $screenshPath $0
  System::Call 'shlwapi::PathIsRelativeW(w r0)i.r1'
  ${If} $0 == ""
  ${OrIf} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(screenshInvalidPath)"
    Abort
  ${EndIf}
  GetFullPathName $INSTDIR "$0"
  GetFullPathName $1 "$INSTDIR\.."
  ${If} $INSTDIR == $1
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(screenshInvalidPath)"
    Abort
  ${EndIf}
FunctionEnd

Function ScreenShSetupProgress
  Call ScreenShSetupResetControls
  SetAutoClose true
  !insertmacro MUI_HEADER_TEXT "$(screenshInstalling)" "$(screenshInstallingDetail)"
  Call ScreenShSetupColors
  !insertmacro screenshColor $mui.InstFilesPage 242424 FBFBFB
  !insertmacro screenshColor $mui.InstFilesPage.Text 6B6B6B FBFBFB
  !insertmacro screenshColor $mui.InstFilesPage.Log 242424 FFFFFF
  System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
  SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 0xBD6C0F
  SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0xEDEDED
FunctionEnd

Function ScreenShSetupFinish
  Call ScreenShSetupResetControls
  !insertmacro MUI_HEADER_TEXT "ScreenSh" "$(screenshVersionText)"
  nsDialogs::Create 1018
  Pop $screenshPage
  ${NSD_CreateLabel} 12u 12u 275u 30u "$(screenshComplete)"
  Pop $screenshTitle
  SendMessage $screenshTitle ${WM_SETFONT} $screenshTitleFont 1
  ${NSD_CreateLabel} 12u 51u 270u 30u "$(screenshCompleteDetail)"
  Pop $screenshSubtitle
  SendMessage $screenshSubtitle ${WM_SETFONT} $screenshBodyFont 1
  ${NSD_CreateCheckbox} 12u 98u 270u 20u "$(screenshLaunch)"
  Pop $screenshRun
  System::Call 'uxtheme::SetWindowTheme(p $screenshRun, w "", w "")'
  ${NSD_Check} $screenshRun
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 "$(screenshFinish)"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  Call ScreenShSetupColors
  nsDialogs::Show
FunctionEnd

Function ScreenShSetupFinishLeave
  !ifndef SCREENSH_UI_PREVIEW_THEME
    ${NSD_GetState} $screenshRun $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $1 ""
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    ${EndIf}
  !endif
FunctionEnd
!macroend
!endif
