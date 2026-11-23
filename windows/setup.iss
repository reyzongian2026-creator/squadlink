[Setup]
AppId=Squadlink.Desktop.Preview
AppName=Squadlink Preview
AppVersion=0.4.0-preview.7
DefaultDirName={localappdata}\Programs\Squadlink Preview
DefaultGroupName=Squadlink Preview
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\artifacts\installer
OutputBaseFilename=Squadlink-Setup-x64
Compression=lzma2/fast
SolidCompression=yes
UninstallDisplayIcon={app}\Squadlink.exe
SetupIconFile=Squadlink.ico
WizardStyle=modern

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Files]
Source: "..\artifacts\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
[Icons]
Name: "{group}\Squadlink Preview"; Filename: "{app}\Squadlink.exe"
[Run]
Filename: "{app}\Squadlink.exe"; Description: "Abrir Squadlink"; Flags: nowait postinstall skipifsilent
