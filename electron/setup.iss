[Setup]
AppId=Squadlink.Electron.Preview
AppName=Squadlink Moderno
AppVersion=0.5.0-preview.20
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
begin
  Result := '';
  if not IsSquadUpdate or ParentExited then Exit;
  Parent := OpenProcess($100000, False, UpdateParent);  { SYNCHRONIZE only }
  if Parent = 0 then begin
    ParentExited := DLLGetLastError = 87;  { Process has already exited }
  end else begin
    try
      ParentExited := WaitForSingleObject(Parent, 30000) = 0;
    finally
      CloseHandle(Parent);
    end;
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
