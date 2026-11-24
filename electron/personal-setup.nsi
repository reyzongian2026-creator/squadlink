Unicode true
Name "Squadlink con Arcade personal"
OutFile "${OUTPUT_EXE}"
Icon "../windows/Squadlink.ico"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Squadlink Moderno"
SetCompress off
ShowInstDetails nevershow
AutoCloseWindow true
Page instfiles

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=Squadlink-Setup.exe" "${PUBLIC_SETUP}"
  SetOutPath "$PLUGINSDIR\cartridges"
  File "/oname=mario3.nes" "${CARTRIDGES_DIR}/mario3.nes"
  File "/oname=duck-nes.nes" "${CARTRIDGES_DIR}/duck-nes.nes"
  SetOutPath "$PLUGINSDIR"

  ClearErrors
  IfSilent silent_install interactive_install
  silent_install:
    ExecWait '"$PLUGINSDIR\Squadlink-Setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="$INSTDIR"' $0
    Goto finished
  interactive_install:
    ExecWait '"$PLUGINSDIR\Squadlink-Setup.exe"' $0
  finished:
    IfErrors launch_error
    SetErrorLevel $0
    Quit
  launch_error:
    MessageBox MB_ICONSTOP "No se pudo abrir el instalador de Squadlink." /SD IDOK
    SetErrorLevel 1
SectionEnd
