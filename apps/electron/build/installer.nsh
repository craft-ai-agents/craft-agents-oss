; ============================================================================
; apps/electron/build/installer.nsh
;
; Wired in via `nsis.include` in electron-builder.yml.
;
; Why this exists: the app shipped as "Craft Agents" before the ARCHstudio  (brand-leak-allow)
; rebrand, under a different appId. NSIS keys its "previous version" detection
; off the appId GUID, so an installer built with the new appId cannot see the
; old install and leaves its Start Menu entries in place. Those entries point at
; a "Craft Agents.exe" that the new build no longer produces, and at least one  (brand-leak-allow)
; ARCHstudio-named shortcut was created pointing at an exe that never existed —
; which is why an update could leave the app impossible to reopen.
;
; Shortcuts are the only thing removed here. The old install directory and all
; user data are deliberately left alone: this runs before we know the new
; install succeeded, and deleting a working app on a guess is worse than leaving
; a stale folder behind.
; ============================================================================

!macro customInstall
  ; Stale Start Menu shortcuts from the pre-rebrand install.
  Delete "$SMPROGRAMS\Craft Agents.lnk"  ; brand-leak-allow
  Delete "$SMPROGRAMS\ARCHstudio.lnk"
  Delete "$SMPROGRAMS\Craft Agents\Craft Agents.lnk"  ; brand-leak-allow
  Delete "$SMPROGRAMS\Craft Agents\ARCHstudio.lnk"  ; brand-leak-allow
  RMDir "$SMPROGRAMS\Craft Agents"  ; brand-leak-allow

  ; Stale desktop shortcuts. electron-builder recreates the current-brand one
  ; immediately after this macro runs.
  Delete "$DESKTOP\Craft Agents.lnk"  ; brand-leak-allow

  ; The pre-rebrand CLI shim launched the old exe and is dead once that exe is
  ; gone. The PATH entry pointing at it is cleaned up by install-app.ps1; NSIS
  ; only removes the files.
  Delete "$LOCALAPPDATA\Craft Agents\bin\craft-agents.cmd"  ; brand-leak-allow
  RMDir "$LOCALAPPDATA\Craft Agents\bin"  ; brand-leak-allow
  RMDir "$LOCALAPPDATA\Craft Agents"  ; brand-leak-allow
!macroend
