!macro _MARKLUCK_REMOVE_OPENWITH_SLOT EXT SLOT
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
  ${If} $0 == "markluck.exe"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
    StrCpy $3 "1"
  ${EndIf}
!macroend

!macro _MARKLUCK_REMOVE_EXTENSION_ASSOC EXT REMOVE_OLD_MARKDOWN
  ReadRegStr $0 SHCTX "Software\Classes\${EXT}" ""
  ${If} $0 == "MarkLuck.Markdown"
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${ElseIf} $0 == "Markdown"
  ${AndIf} "${REMOVE_OLD_MARKDOWN}" == "1"
    DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\${EXT}" "MarkLuck.Markdown_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "Markdown_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "MarkLuck.Markdown"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "Markdown"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "MarkLuck.Markdown"
  ${If} "${REMOVE_OLD_MARKDOWN}" == "1"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "Markdown"
  ${EndIf}

  StrCpy $3 "0"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "a"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "b"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "c"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "d"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "e"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "f"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "g"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "h"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "i"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "j"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "k"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "l"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "m"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "n"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "o"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "p"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "q"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "r"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "s"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "t"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "u"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "v"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "w"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "x"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "y"
  !insertmacro _MARKLUCK_REMOVE_OPENWITH_SLOT "${EXT}" "z"
  ${If} $3 == "1"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "MRUList"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\MarkLuck.Markdown\DefaultIcon" "" "$\"$INSTDIR\file-icon.ico$\",0"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $2 "0"
  ReadRegStr $0 SHCTX "Software\Classes\Markdown\DefaultIcon" ""
  ReadRegStr $1 SHCTX "Software\Classes\Markdown\shell\open\command" ""
  ${If} $0 == "$\"$INSTDIR\file-icon.ico$\",0"
  ${OrIf} $0 == "$INSTDIR\file-icon.ico,0"
  ${OrIf} $0 == "$INSTDIR\markluck.exe,0"
  ${OrIf} $1 == "$INSTDIR\markluck.exe $\"%1$\""
  ${OrIf} $1 == "$INSTDIR\markluck.exe %1"
    StrCpy $2 "1"
  ${EndIf}

  !insertmacro _MARKLUCK_REMOVE_EXTENSION_ASSOC ".md" "$2"
  !insertmacro _MARKLUCK_REMOVE_EXTENSION_ASSOC ".markdown" "$2"
  !insertmacro _MARKLUCK_REMOVE_EXTENSION_ASSOC ".mdx" "$2"

  DeleteRegKey SHCTX "Software\Classes\MarkLuck.Markdown"
  ${If} $2 == "1"
    DeleteRegKey SHCTX "Software\Classes\Markdown"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\Applications\markluck.exe"
  !insertmacro UPDATEFILEASSOC
!macroend
