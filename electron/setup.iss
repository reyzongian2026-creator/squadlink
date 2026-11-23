[Setup]
AppId=Squadlink.Electron.Preview
AppName=Squadlink Moderno
AppVersion=0.5.0-preview.2
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
[Icons]
Name: "{group}\Squadlink Moderno"; Filename: "{app}\Squadlink.exe"; IconFilename: "{app}\resources\app\Squadlink.ico"
[Run]
Filename: "{app}\Squadlink.exe"; Description: "Abrir Squadlink"; Flags: nowait postinstall skipifsilent
