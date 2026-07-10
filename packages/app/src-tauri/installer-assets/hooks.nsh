!macro _JotLuck_REMOVE_OPENWITH_SLOT EXT SLOT
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
  ${If} $0 == "JotLuck.exe"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
    StrCpy $3 "1"
  ${EndIf}
!macroend

!macro _JotLuck_REMOVE_EXTENSION_ASSOC EXT REMOVE_OLD_MARKDOWN
  ReadRegStr $0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $0 == "JotLuck.Markdown"
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${ElseIf} $0 == "Markdown"
  ${AndIf} "${REMOVE_OLD_MARKDOWN}" == "1"
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\${EXT}" "JotLuck.Markdown_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "Markdown_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.Markdown"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "Markdown"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.Markdown"
  ${If} "${REMOVE_OLD_MARKDOWN}" == "1"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "Markdown"
  ${EndIf}

  StrCpy $3 "0"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "a"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "b"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "c"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "d"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "e"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "f"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "g"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "h"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "i"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "j"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "k"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "l"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "m"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "n"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "o"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "p"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "q"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "r"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "s"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "t"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "u"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "v"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "w"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "x"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "y"
  !insertmacro _JotLuck_REMOVE_OPENWITH_SLOT "${EXT}" "z"
  ${If} $3 == "1"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "MRUList"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\JotLuck.Markdown\DefaultIcon" "" "$\"$INSTDIR\file-icon.ico$\",0"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $2 "0"
  ReadRegStr $0 SHCTX "Software\Classes\Markdown\DefaultIcon" ""
  ReadRegStr $1 SHCTX "Software\Classes\Markdown\shell\open\command" ""
  ${If} $0 == "$\"$INSTDIR\file-icon.ico$\",0"
  ${OrIf} $0 == "$INSTDIR\file-icon.ico,0"
  ${OrIf} $0 == "$INSTDIR\JotLuck.exe,0"
  ${OrIf} $1 == "$INSTDIR\JotLuck.exe $\"%1$\""
  ${OrIf} $1 == "$INSTDIR\JotLuck.exe %1"
    StrCpy $2 "1"
  ${EndIf}

  !insertmacro _JotLuck_REMOVE_EXTENSION_ASSOC ".md" "$2"
  !insertmacro _JotLuck_REMOVE_EXTENSION_ASSOC ".markdown" "$2"
  !insertmacro _JotLuck_REMOVE_EXTENSION_ASSOC ".mdx" "$2"

  DeleteRegKey SHCTX "Software\Classes\JotLuck.Markdown"
  ${If} $2 == "1"
    DeleteRegKey SHCTX "Software\Classes\Markdown"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\Applications\JotLuck.exe"
  !insertmacro UPDATEFILEASSOC
!macroend
