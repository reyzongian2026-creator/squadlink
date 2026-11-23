# Validate the installed Windows UI against an isolated lobby on the build runner.
param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$profileDir = Join-Path $env:LOCALAPPDATA 'Squadlink Preview'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$env:HOST = '127.0.0.1'
$env:PORT = '4179'
'http://127.0.0.1:4179' | Set-Content (Join-Path $profileDir 'server.txt')
$serverProcess = Start-Process node -ArgumentList 'test/windows/voice-lobby.mjs' -PassThru -WindowStyle Hidden
$app = $null
$voicePeer = $null
function Find-Control($root, $name, [bool]$partial = $false) {
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  if ($partial) { $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button) }
  $until = [DateTime]::UtcNow.AddSeconds(30)
  do {
    if ($partial) { $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) | Where-Object { $_.Current.Name -like "*$name*" } | Select-Object -First 1 }
    else { $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition) }
    if ($found) { return $found }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  $names = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -First 55
  Write-Output ($names -join ' | ') | Out-Host
  throw "El control '$name' no apareció."
}
function Invoke-Control($root, $name) {
  (Find-TypedControl $root $name ([System.Windows.Automation.ControlType]::Button)).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Find-TypedControl($root, $name, $type) {
  $criteria = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type))
  $until = [DateTime]::UtcNow.AddSeconds(25)
  do {
    $candidates = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $criteria)
    foreach ($element in $candidates) { if ($element.Current.IsEnabled -and !$element.Current.IsOffscreen) {return $element} }
    foreach ($element in $candidates) {
      if (!$element.Current.IsEnabled) {continue}
      $scroll = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) {$scroll.ScrollIntoView()}
      return $element
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $until)
  $labels = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName):$($_.Current.Name)" } | Select-Object -Last 85
  Write-Host ($labels -join ' | ')
  throw "No se encontró $type con nombre '$name'."
}
function Set-Mode($root, $name) {
  Invoke-Control $root 'Ajustes'
  $mode = Find-TypedControl $root $name ([System.Windows.Automation.ControlType]::RadioButton)
  if (!$mode.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) {
    $mode.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  }
}
function Get-ClientProcesses([int]$rootId) {
  $tree = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
  $ids = [Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($rootId)
  do {
    $before=$ids.Count
    foreach($p in $tree) { if($ids.Contains([int]$p.ParentProcessId)){ [void]$ids.Add([int]$p.ProcessId) } }
  } while($before -ne $ids.Count)
  Get-Process -Id ([int[]]$ids) -ErrorAction SilentlyContinue
}
function Measure-Idle($label) {
  Start-Sleep -Seconds 2
  $first = @(Get-ClientProcesses $app.Id | Select-Object Id, CPU)
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Seconds 8
  $last = @(Get-ClientProcesses $app.Id | Select-Object Id, CPU, WorkingSet64, ProcessName)
  $timer.Stop()
  $startCpu = ($first | Measure-Object CPU -Sum).Sum
  $endCpu = ($last | Measure-Object CPU -Sum).Sum
  $cpuPercent = [Math]::Round(100*($endCpu-$startCpu)/$timer.Elapsed.TotalSeconds/[Environment]::ProcessorCount,2)
  if (Compare-Object @($first.Id | Sort-Object) @($last.Id | Sort-Object)) { $cpuPercent = 'N/D (cambio de procesos)' }
  $mib = [Math]::Round(($last | Measure-Object WorkingSet64 -Sum).Sum/1MB,1)
  $children = @($last | Where-Object ProcessName -eq 'msedgewebview2').Count
  Write-Output "METRICA $label | RAM_MiB=$mib CPU_pct=$cpuPercent WebView2=$children Cores=$([Environment]::ProcessorCount)"
  if (($label.StartsWith('directorio-') -or $label -eq 'amigos-invitado-bajo') -and $children -ne 0) { throw 'El directorio inició WebView2.' }
}
function Save-Window($handle, $file = 'Squadlink-escritorio.png') {
  Add-Type -AssemblyName System.Drawing
  if (!('WindowImage' -as [type])) { Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WindowImage {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
    public struct Rect { public int Left, Top, Right, Bottom; }
}
"@
  }
  $rect = New-Object WindowImage+Rect
  if(![WindowImage]::GetWindowRect($handle,[ref]$rect)){ throw 'Falta el tamaño de la ventana.' }
  $image=[Drawing.Bitmap]::new(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
  try {
    $g=[Drawing.Graphics]::FromImage($image)
    try { $dc=$g.GetHdc(); try { if(![WindowImage]::PrintWindow($handle,$dc,2)){throw 'La ventana no se pudo capturar.'} } finally {$g.ReleaseHdc($dc)} } finally {$g.Dispose()}
    $image.Save((Join-Path (Get-Location) ('artifacts/installer/'+$file)),[Drawing.Imaging.ImageFormat]::Png)
  } finally {$image.Dispose()}
}
try {
  $ready = $false
  for ($i=0; $i -lt 40 -and !$ready; $i++) {
    try { $ready = (Invoke-WebRequest 'http://127.0.0.1:4179/api/directory' -TimeoutSec 2).StatusCode -eq 200 }
    catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$ready) { throw 'El servidor de prueba no arrancó.' }
  foreach ($example in @(@('Andes Five', 'VALORANT', 'Platino'),@('Después del trabajo','Rocket League','Todos los niveles'))) {
    $fixture = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    Invoke-RestMethod -Uri 'http://127.0.0.1:4179/api/session' -Method Post -ContentType 'application/json' -Body (@{nick='Jugador QA'}|ConvertTo-Json) -WebSession $fixture | Out-Null
    Invoke-RestMethod -Uri 'http://127.0.0.1:4179/api/rooms' -Method Post -ContentType 'application/json' -Body (@{name=$example[0];directory=@{published=$true;game=$example[1];level=$example[2]}}|ConvertTo-Json) -WebSession $fixture | Out-Null
  }
  # Keep the installer and its installed directory intact. Supply only the audio input
  # and RTP counters in a private test copy of the published desktop client.
  $fixtureDir = Join-Path $env:RUNNER_TEMP 'squadlink-synthetic-audio'
  Copy-Item -Path (Split-Path $Executable) -Destination $fixtureDir -Recurse
  $testClient = Join-Path $fixtureDir 'Client/desktop.js'
  $fixture = Get-Content test/windows/audio-fixture.js -Raw
  $original = Get-Content $testClient -Raw
  [IO.File]::WriteAllText($testClient, $fixture + [Environment]::NewLine + $original)
  $installedExe = $Executable
  $Executable = Join-Path $fixtureDir 'Squadlink.exe'
  $app = Start-Process $Executable -PassThru
  if (!$app.WaitForInputIdle(20000)) { throw 'La ventana no inició.' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $app.Refresh()
    if ($app.HasExited) { throw "La aplicación terminó al arrancar (código $($app.ExitCode))." }
    if ($app.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
  Find-Control $root 'Andes Five' | Out-Null
  Find-Control $root 'Crear sala' | Out-Null
  Invoke-Control $root 'Ajustes'
  Invoke-Control $root 'Actualizaciones'
  Find-Control $root 'Buscar actualizaciones' | Out-Null
  Find-Control $root 'Buscar al abrir Squadlink' | Out-Null
  $version = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -like "*Compilación ${env:GITHUB_RUN_NUMBER}.${env:GITHUB_RUN_ATTEMPT}*" }
  if (!$version) {throw 'La versión instalada carece de identidad de compilación.'}
  Invoke-Control $root 'Voz'
  Find-Control $root 'Andes Five' | Out-Null
  $selectionPattern = [System.Windows.Automation.SelectionItemPattern]::Pattern
  (Find-Control $root 'Andes Five').GetCurrentPattern($selectionPattern).Select()
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4179/api/test-directory?fail=1' | Out-Null
  try {
    Invoke-Control $root 'Actualizar'
    Find-Control $root 'No se pudo cargar el directorio. Pulsa Actualizar para reintentar.' | Out-Null
    if (!(Find-Control $root 'Andes Five').GetCurrentPattern($selectionPattern).Current.IsSelected) { throw 'El directorio perdió la sala seleccionada al fallar la red.' }
    if (!(Find-Control $root 'Entrar a la sala').Current.IsEnabled) { throw 'La sala guardada dejó de estar disponible.' }
  } finally {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4179/api/test-directory?fail=0' | Out-Null
  }
  Invoke-Control $root 'Actualizar'
  $fixtureEndpoint = 'http://127.0.0.1:4179/api/test-directory'
  Invoke-RestMethod -Method Post -Uri ($fixtureEndpoint + '?pages=normal') | Out-Null
  try {
    Invoke-Control $root 'Actualizar'
    Find-Control $root 'Sala norte' | Out-Null
    Invoke-Control $root 'Cargar más'
    (Find-Control $root 'Sala centro').GetCurrentPattern($selectionPattern).Select()
    Invoke-RestMethod -Method Post -Uri ($fixtureEndpoint + '?pages=partial-error') | Out-Null
    Invoke-Control $root 'Actualizar'
    Find-Control $root 'No se pudo cargar el directorio. Pulsa Actualizar para reintentar.' | Out-Null
    if (!(Find-Control $root 'Sala centro').GetCurrentPattern($selectionPattern).Current.IsSelected) { throw 'Se perdió la selección al fallar la segunda página.' }
    Invoke-RestMethod -Method Post -Uri ($fixtureEndpoint + '?pages=normal') | Out-Null
    Invoke-Control $root 'Actualizar'
    Find-Control $root 'Sala de prueba' | Out-Null
    if (!(Find-Control $root 'Sala centro').GetCurrentPattern($selectionPattern).Current.IsSelected) { throw 'La segunda página se perdió al actualizar el directorio.' }
    Invoke-Control $root 'Cargar más'
    Find-Control $root 'Sala sur' | Out-Null
  } finally {
    Invoke-RestMethod -Method Post -Uri $fixtureEndpoint | Out-Null
  }
  Invoke-Control $root 'Actualizar'
  Find-Control $root 'Andes Five' | Out-Null
  Measure-Idle 'directorio-nativo'
  Save-Window $app.MainWindowHandle
  Invoke-Control $root 'Comunidad'
  Find-Control $root 'Elegir mi apodo' | Out-Null
  Measure-Idle 'amigos-invitado-bajo'
  # Reproduce incomplete local assets in the isolated copy and recover in the same process.
  $held = $testClient + '.held'
  Move-Item $testClient $held
  try {
    Invoke-Control $root 'Elegir mi apodo'
    Find-Control $root 'Reintentar sección' | Out-Null
    [IO.File]::WriteAllText($testClient, '// Fixture: the desktop bridge never starts.')
    Invoke-Control $root 'Reintentar sección'
    Find-Control $root 'Abriendo sección…' | Out-Null
    Find-Control $root 'Reintentar sección' | Out-Null
  } finally { Move-Item $held $testClient -Force }
  Invoke-Control $root 'Reintentar sección'
  Find-Control $root 'Tu apodo' | Out-Null
  Write-Output 'La ventana nativa recuperó la sección tras restaurar el recurso local.'
  Set-Mode $root 'Experiencia completa'
  Save-Window $app.MainWindowHandle 'Ajustes-rendimiento.png'
  Invoke-Control $root 'Comunidad'
  Find-Control $root 'Elegir mi apodo' | Out-Null
  Measure-Idle 'amigos-completo'
  Set-Mode $root 'Bajo consumo'
  Invoke-Control $root 'Comunidad'
  Invoke-Control $root 'Mi jugador'
  Find-Control $root 'Editar mi apodo' | Out-Null
  Invoke-Control $root 'Juegos'
  Find-Control $root 'Reflejos' $true | Out-Null
  Invoke-Control $root 'Clasificación'
  Find-Control $root 'Ranking arcade' | Out-Null
  Invoke-Control $root 'Ajustes'
  Invoke-Control $root 'Dispositivos'
  Find-Control $root 'Ajustes de voz' | Out-Null
  Invoke-Control $root 'Servidor'
  Find-Control $root 'Servidor del grupo' | Out-Null
  Invoke-Control $root 'Voz'
  Find-Control $root 'Andes Five' | Out-Null
  Invoke-Control $root 'Unirme con código'
  Find-Control $root 'Código de sala' | Out-Null
  Invoke-Control $root 'Explorar salas'
  Find-Control $root 'Andes Five' | Out-Null
  Start-Sleep -Seconds 4
  Measure-Idle 'directorio-tras-volver'
  Invoke-Control $root 'Juegos'
  Find-Control $root 'Reflejos' $true | Out-Null
  Invoke-Control $root 'Voz'
  Invoke-Control $root 'Crear sala'
  Write-Host 'Formulario de creación abierto'
  $nick = Find-TypedControl $root 'Tu apodo' ([System.Windows.Automation.ControlType]::Edit)
  $nick.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('Prueba')
  $name = Find-TypedControl $root 'Nombre de la sala' ([System.Windows.Automation.ControlType]::Edit)
  $name.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('Canal de prueba')
  Write-Host 'Apodo y nombre de sala ingresados'
  $submit = Find-TypedControl $root 'Crear sala' ([System.Windows.Automation.ControlType]::Button)
  $submit.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Find-Control $root 'Abrir controles de sala' | Out-Null
  Measure-Idle 'sala-bajo-sin-microfono'
  $label = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -match '^Código de sala: ([A-Z0-9]{6})' } | Select-Object -First 1
  if (!$label -or $label.Current.Name -notmatch '^Código de sala: ([A-Z0-9]{6})') {throw 'Falta el código de la sala de prueba.'}
  $roomCode = $Matches[1]
  $sync = Join-Path $env:RUNNER_TEMP 'squadlink-voice-bench'
  New-Item -ItemType Directory -Force $sync | Out-Null
  $voicePeer = Start-Process node -ArgumentList ('test/windows/live-voice.mjs ' + $roomCode + ' "' + $sync + '"') -PassThru -RedirectStandardOutput (Join-Path $sync 'peer.log') -RedirectStandardError (Join-Path $sync 'peer.err')
  Invoke-Control $root 'Activar micrófono'
  Find-Control $root 'Silenciar micrófono' | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds(80)
  while (!(Test-Path (Join-Path $sync 'connected')) -and !$voicePeer.HasExited -and [DateTime]::UtcNow -lt $deadline) {Start-Sleep -Milliseconds 200}
  if (!(Test-Path (Join-Path $sync 'connected'))) {Get-Content (Join-Path $sync 'peer.err'); throw 'No llegó audio al segundo cliente.'}
  Measure-Idle 'voz-activa-bajo'
  Set-Mode $root 'Experiencia completa'
  Invoke-Control $root 'Voz'
  Invoke-Control $root 'Mi sala'
  Find-Control $root 'Participantes' | Out-Null
  Measure-Idle 'voz-activa-completo'
  'done' | Set-Content (Join-Path $sync 'finish')
  if (!$voicePeer.WaitForExit(15000) -or $voicePeer.ExitCode -ne 0) {Get-Content (Join-Path $sync 'peer.err'); throw 'Falló la comprobación de voz tras cambiar el perfil.'}
  Get-Content (Join-Path $sync 'peer.log')
  Invoke-Control $root 'Juegos'
  Find-Control $root 'Reflejos' $true | Out-Null
  Find-Control $root 'Canal de prueba' | Out-Null
  Invoke-Control $root 'Voz'
  Start-Sleep -Seconds 4
  if (!(Find-Control $root 'Salir de sala').Current.IsEnabled) { throw 'Se perdió la llamada al volver al directorio.' }
  Invoke-Control $root 'Salir de sala'
  Find-Control $root 'Sin sala' | Out-Null
  $app.CloseMainWindow() | Out-Null
  if (!$app.WaitForExit(10000)) { throw 'La aplicación no cerró correctamente.' }
  $app = Start-Process $installedExe -PassThru
  $until = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $app.Refresh()
    if ($app.MainWindowHandle -ne [IntPtr]::Zero) {break}
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $until)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
  Invoke-Control $root 'Ajustes'
  $saved = Find-TypedControl $root 'Experiencia completa' ([System.Windows.Automation.ControlType]::RadioButton)
  if (!$saved.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { throw 'No se conservó el perfil de rendimiento.' }
  Write-Output 'Perfiles, memoria, continuidad de sala y persistencia tras reinicio verificados.'
  Write-Output 'Verificados directorio, grupos, secciones, perfil, clasificación, audio y entrada por código.'
} finally {
  if ($voicePeer -and !$voicePeer.HasExited) { $voicePeer.Kill(); $voicePeer.WaitForExit() }
  if ($app -and !$app.HasExited) { $app.Kill(); $app.WaitForExit() }
  if (!$serverProcess.HasExited) { $serverProcess.Kill(); $serverProcess.WaitForExit() }
}
