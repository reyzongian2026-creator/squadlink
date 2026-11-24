[Setup]
AppId=Squadlink.Electron.Preview
AppName=Squadlink Moderno
AppVersion=0.5.0-preview.26
DefaultDirName={localappdata}\Programs\Squadlink Moderno
DefaultGroupName=Squadlink Moderno
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\artifacts\electron
OutputBaseFilename=Squadlink-Moderno-Setup-x64
Compression=lzma2/fast
SolidCompression=yes
SetupIconFile=..\windows\Squadlink.ico
UninstallDisplayIcon={app}\Squadlink.exe
WizardStyle=modern
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Files]
Source: "..\artifacts\portable\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{src}\cartridges\mario3.nes"; DestDir: "{app}\resources\app\cartridges"; Flags: external ignoreversion skipifsourcedoesntexist; Check: not IsSquadUpdate
Source: "{src}\cartridges\duck-nes.nes"; DestDir: "{app}\resources\app\cartridges"; Flags: external ignoreversion skipifsourcedoesntexist; Check: not IsSquadUpdate
[Icons]
Name: "{group}\Squadlink Moderno"; Filename: "{app}\Squadlink.exe"; IconFilename: "{app}\resources\app\Squadlink.ico"
[Run]
Filename: "{app}\Squadlink.exe"; Description: "Abrir Squadlink"; Flags: nowait postinstall skipifsilent

[Code]
function OpenProcess(Access: LongWord; Inherit: Boolean; ProcessId: LongWord): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Timeout: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

var
  ParentExited: Boolean;

function UpdateParent: Integer;
begin
  Result := StrToIntDef(ExpandConstant('{param:SQUADUPDATEPID|0}'), 0);
end;

function IsSquadUpdate: Boolean;
begin
  Result := UpdateParent > 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Parent: THandle;
  SessionDir: String;
  Index: Integer;
begin
  Result := '';
  if not IsSquadUpdate or ParentExited then Exit;
  SessionDir := ExpandConstant('{param:SQUADSESSION|}');
  if (Length(SessionDir) <> 19) or (Copy(SessionDir, 1, 13) <> 'squad-update-') then begin
    Result := 'No se pudo comprobar la sesión de actualización.';
    Exit;
  end;
  for Index := 14 to 19 do
    if Pos(SessionDir[Index], '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') = 0 then begin
      Result := 'Sesión de actualización no válida.';
      Exit;
    end;
  SessionDir := ExpandConstant('{src}\') + SessionDir;
  Parent := OpenProcess($100000, False, UpdateParent);  { SYNCHRONIZE only }
  if (Parent = 0) and (DLLGetLastError <> 87) then begin
    Result := 'No se pudo comprobar el proceso de Squadlink.';
    Exit;
  end;
  try
    if not DirExists(SessionDir) or not SaveStringToFile(SessionDir + '\ready', '1', False) then begin
      Result := 'La aplicación canceló esta actualización.';
      Exit;
    end;
    if Parent = 0 then
      ParentExited := True  { The given process no longer exists }
    else
      ParentExited := WaitForSingleObject(Parent, 30000) = 0;
  finally
    if Parent <> 0 then CloseHandle(Parent);
  end;
  if not ParentExited then
    Result := 'Squadlink sigue abierto. Se conservó la instalación actual.';
end;

procedure DeinitializeSetup;
var
  ApplicationPath, ProfilePath, Arguments: String;
  ExitCode, Tail: Integer;
begin
  if not ParentExited then Exit;
  ApplicationPath := ExpandConstant('{app}\Squadlink.exe');
  if not FileExists(ApplicationPath) then Exit;
  ProfilePath := ExpandConstant('{param:SQUADPROFILE|}');
  Arguments := '';
  if (ProfilePath <> '') and (Pos('"', ProfilePath) = 0) then begin
    Arguments := '"--user-data-dir=' + ProfilePath;
    Tail := Length(ProfilePath);
    while Tail > 0 do begin
      if ProfilePath[Tail] <> '\' then Break;
      Arguments := Arguments + '\';
      Tail := Tail - 1;
    end;
    Arguments := Arguments + '"';
  end;
  if not Exec(ApplicationPath, Arguments, ExpandConstant('{app}'), SW_SHOWNORMAL, ewNoWait, ExitCode) then
    Log('No se pudo volver a abrir Squadlink: ' + IntToStr(ExitCode));
end;
