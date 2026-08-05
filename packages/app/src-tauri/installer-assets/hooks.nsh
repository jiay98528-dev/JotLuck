!macro _JotLuck_REMOVE_OPENWITH_SLOT EXT SLOT
  ReadRegStr $0 SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
  ${If} $0 == "JotLuck.exe"
    DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "${SLOT}"
    ReadRegStr $4 SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "MRUList"
    StrCpy $5 ""
    StrCpy $6 "0"
    StrLen $7 $4
    ${DoWhile} $6 < $7
      StrCpy $8 $4 1 $6
      ${If} $8 != "${SLOT}"
        StrCpy $5 "$5$8"
      ${EndIf}
      IntOp $6 $6 + 1
    ${Loop}
    ${If} $5 == ""
      DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "MRUList"
    ${Else}
      WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithList" "MRUList" "$5"
    ${EndIf}
  ${EndIf}
!macroend

; Old installers used Tauri's APP_ASSOCIATE macro, which changed the default
; ProgID. Restore the backed-up default only when the current default is one
; of JotLuck's own historical ProgIDs. New installs never write this value.
!macro _JotLuck_RESTORE_OWNED_DEFAULT EXT REMOVE_OLD_MARKDOWN
  ReadRegStr $0 SHCTX "Software\Classes\${EXT}" ""
  StrCpy $1 "0"
  ${If} $0 == "JotLuck.Note"
    StrCpy $1 "1"
  ${ElseIf} $0 == "JotLuck.Markdown"
    StrCpy $1 "1"
  ${ElseIf} $0 == "Markdown"
  ${AndIf} "${REMOVE_OLD_MARKDOWN}" == "1"
    StrCpy $1 "1"
  ${EndIf}

  ${If} $1 == "1"
    ReadRegStr $4 SHCTX "Software\Classes\${EXT}" "JotLuck.Note_backup"
    ${If} $4 == ""
      ReadRegStr $4 SHCTX "Software\Classes\${EXT}" "JotLuck.Markdown_backup"
    ${EndIf}
    ${If} $4 == ""
      ReadRegStr $4 SHCTX "Software\Classes\${EXT}" "Markdown_backup"
    ${EndIf}
    ${If} $4 == ""
      DeleteRegValue SHCTX "Software\Classes\${EXT}" ""
    ${Else}
      WriteRegStr SHCTX "Software\Classes\${EXT}" "" "$4"
    ${EndIf}
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\${EXT}" "JotLuck.Note_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "JotLuck.Markdown_backup"
  DeleteRegValue SHCTX "Software\Classes\${EXT}" "Markdown_backup"
!macroend

!macro _JotLuck_REGISTER_OPTIONAL_ASSOC EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.Note" ""
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.Note" ""
  WriteRegStr SHCTX "Software\Classes\Applications\JotLuck.exe\SupportedTypes" "${EXT}" ""
!macroend

!macro _JotLuck_REGISTER_DOCUMENT_ASSOC EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.DocumentImport" ""
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.DocumentImport" ""
  WriteRegStr SHCTX "Software\Classes\Applications\JotLuck.exe\SupportedTypes" "${EXT}" ""
!macroend

; Public file types without an explicit user choice can otherwise be silently
; assigned to the newest OpenWith candidate. Microsoft requires this REG_NONE
; marker when a ProgID must remain a candidate without becoming that fallback.
; The bundle is currentUser-only, so its SHCTX is always HKEY_CURRENT_USER.
!macro _JotLuck_PREVENT_SILENT_DEFAULT PROGID
  System::Call 'advapi32::RegOpenKeyExW(i 0x80000001, w "Software\Classes\${PROGID}", i 0, i 0x0002, *p .r9) i .r8'
  ${If} $8 == 0
    System::Call 'advapi32::RegSetValueExW(p r9, w "AllowSilentDefaultTakeOver", i 0, i 0, p 0, i 0) i .r8'
    System::Call 'advapi32::RegCloseKey(p r9)'
  ${EndIf}
!macroend

!macro _JotLuck_REMOVE_OPTIONAL_ASSOC EXT REMOVE_OLD_MARKDOWN
  !insertmacro _JotLuck_RESTORE_OWNED_DEFAULT "${EXT}" "${REMOVE_OLD_MARKDOWN}"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.Note"
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.Markdown"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.Note"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.Markdown"
  DeleteRegValue SHCTX "Software\Classes\Applications\JotLuck.exe\SupportedTypes" "${EXT}"

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
!macroend

!macro _JotLuck_REMOVE_DOCUMENT_ASSOC EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "JotLuck.DocumentImport"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${EXT}\OpenWithProgids" "JotLuck.DocumentImport"
  DeleteRegValue SHCTX "Software\Classes\Applications\JotLuck.exe\SupportedTypes" "${EXT}"

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
!macroend

!macro NSIS_HOOK_POSTINSTALL
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

  !insertmacro _JotLuck_RESTORE_OWNED_DEFAULT ".md" "$2"
  !insertmacro _JotLuck_RESTORE_OWNED_DEFAULT ".markdown" "$2"
  !insertmacro _JotLuck_RESTORE_OWNED_DEFAULT ".mdx" "$2"
  !insertmacro _JotLuck_RESTORE_OWNED_DEFAULT ".txt" "0"

  WriteRegStr SHCTX "Software\Classes\JotLuck.Note" "" "$(JotLuckFileType)"
  WriteRegStr SHCTX "Software\Classes\JotLuck.Note\DefaultIcon" "" "$\"$INSTDIR\file-icon.ico$\",0"
  WriteRegStr SHCTX "Software\Classes\JotLuck.Note\shell\open\command" "" "$\"$INSTDIR\JotLuck.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\JotLuck.DocumentImport" "" "$(JotLuckDocumentType)"
  WriteRegStr SHCTX "Software\Classes\JotLuck.DocumentImport\DefaultIcon" "" "$\"$INSTDIR\file-icon.ico$\",0"
  WriteRegStr SHCTX "Software\Classes\JotLuck.DocumentImport\shell\open\command" "" "$\"$INSTDIR\JotLuck.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\JotLuck.exe\shell\open\command" "" "$\"$INSTDIR\JotLuck.exe$\" $\"%1$\""
  !insertmacro _JotLuck_PREVENT_SILENT_DEFAULT "JotLuck.Note"
  !insertmacro _JotLuck_PREVENT_SILENT_DEFAULT "JotLuck.DocumentImport"
  !insertmacro _JotLuck_REGISTER_OPTIONAL_ASSOC ".md"
  !insertmacro _JotLuck_REGISTER_OPTIONAL_ASSOC ".markdown"
  !insertmacro _JotLuck_REGISTER_OPTIONAL_ASSOC ".mdx"
  !insertmacro _JotLuck_REGISTER_OPTIONAL_ASSOC ".txt"
  !insertmacro _JotLuck_REGISTER_DOCUMENT_ASSOC ".docx"
  !insertmacro _JotLuck_REGISTER_DOCUMENT_ASSOC ".pdf"
  !insertmacro _JotLuck_REGISTER_DOCUMENT_ASSOC ".xlsx"
  !insertmacro _JotLuck_REGISTER_DOCUMENT_ASSOC ".xls"

  WriteRegStr SHCTX "Software\JotLuck\Capabilities" "ApplicationName" "JotLuck"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities" "ApplicationDescription" "$(JotLuckFileType)"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".md" "JotLuck.Note"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".markdown" "JotLuck.Note"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".mdx" "JotLuck.Note"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".txt" "JotLuck.Note"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".docx" "JotLuck.DocumentImport"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".pdf" "JotLuck.DocumentImport"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".xlsx" "JotLuck.DocumentImport"
  WriteRegStr SHCTX "Software\JotLuck\Capabilities\FileAssociations" ".xls" "JotLuck.DocumentImport"
  WriteRegStr SHCTX "Software\RegisteredApplications" "JotLuck" "Software\JotLuck\Capabilities"
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

  !insertmacro _JotLuck_REMOVE_OPTIONAL_ASSOC ".md" "$2"
  !insertmacro _JotLuck_REMOVE_OPTIONAL_ASSOC ".markdown" "$2"
  !insertmacro _JotLuck_REMOVE_OPTIONAL_ASSOC ".mdx" "$2"
  !insertmacro _JotLuck_REMOVE_OPTIONAL_ASSOC ".txt" "0"
  !insertmacro _JotLuck_REMOVE_DOCUMENT_ASSOC ".docx"
  !insertmacro _JotLuck_REMOVE_DOCUMENT_ASSOC ".pdf"
  !insertmacro _JotLuck_REMOVE_DOCUMENT_ASSOC ".xlsx"
  !insertmacro _JotLuck_REMOVE_DOCUMENT_ASSOC ".xls"

  DeleteRegKey SHCTX "Software\Classes\JotLuck.Note"
  DeleteRegKey SHCTX "Software\Classes\JotLuck.DocumentImport"
  DeleteRegKey SHCTX "Software\Classes\JotLuck.Markdown"
  ${If} $2 == "1"
    DeleteRegKey SHCTX "Software\Classes\Markdown"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\Applications\JotLuck.exe"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "JotLuck"
  DeleteRegKey SHCTX "Software\JotLuck\Capabilities"
  !insertmacro UPDATEFILEASSOC
!macroend
