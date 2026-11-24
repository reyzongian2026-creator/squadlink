[Setup]
AppId=Squadlink.Electron.Preview
AppName=Squadlink Moderno
AppVersion=0.5.0-preview.16
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
Source: "{src}\cartridges\mario3.nes"; DestDir: "{app}\resources\app\cartridges"; Flags: external ignoreversion skipifsourcedoesntexist
Source: "{src}\cartridges\duck-nes.nes"; DestDir: "{app}\resources\app\cartridges"; Flags: external ignoreversion skipifsourcedoesntexist
[Icons]
Name: "{group}\Squadlink Moderno"; Filename: "{app}\Squadlink.exe"; IconFilename: "{app}\resources\app\Squadlink.ico"
[Run]
Filename: "{app}\Squadlink.exe"; Description: "Abrir Squadlink"; Flags: nowait postinstall skipifsilent
