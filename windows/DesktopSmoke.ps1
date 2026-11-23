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
$serverProcess = Start-Process node -ArgumentList 'server.mjs' -PassThru -WindowStyle Hidden
$app = $null
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
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $until)
  throw "No se encontró $type con nombre '$name'."
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
  $first = @(Get-ClientProcesses $app.Id)
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Seconds 8
  $last = @(Get-ClientProcesses $app.Id)
  $timer.Stop()
  $startCpu = ($first | Measure-Object CPU -Sum).Sum
  $endCpu = ($last | Measure-Object CPU -Sum).Sum
  $cpuPercent = [Math]::Round(100*($endCpu-$startCpu)/$timer.Elapsed.TotalSeconds/[Environment]::ProcessorCount,2)
  $mib = [Math]::Round(($last | Measure-Object WorkingSet64 -Sum).Sum/1MB,1)
  $children = @($last | Where-Object ProcessName -eq 'msedgewebview2').Count
  Write-Output "METRICA $label | RAM_MiB=$mib CPU_pct=$cpuPercent WebView2=$children Cores=$([Environment]::ProcessorCount)"
  if ($label.StartsWith('directorio-') -and $children -ne 0) { throw 'El directorio inició WebView2.' }
}
function Save-Window($handle) {
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WindowImage {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
    public struct Rect { public int Left, Top, Right, Bottom; }
}
"@
  $rect = New-Object WindowImage+Rect
  if(![WindowImage]::GetWindowRect($handle,[ref]$rect)){ throw 'Falta el tamaño de la ventana.' }
  $image=[Drawing.Bitmap]::new(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
  try {
    $g=[Drawing.Graphics]::FromImage($image)
    try { $dc=$g.GetHdc(); try { if(![WindowImage]::PrintWindow($handle,$dc,2)){throw 'La ventana no se pudo capturar.'} } finally {$g.ReleaseHdc($dc)} } finally {$g.Dispose()}
    $image.Save((Join-Path (Get-Location) 'artifacts/installer/Squadlink-escritorio.png'),[Drawing.Imaging.ImageFormat]::Png)
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
  Measure-Idle 'directorio-nativo'
  Save-Window $app.MainWindowHandle
  Invoke-Control $root 'Comunidad'
  Find-Control $root 'Elegir mi apodo' | Out-Null
  Measure-Idle 'amigos-sin-llamada'
  Invoke-Control $root 'Mi jugador'
  Find-Control $root 'Editar mi apodo' | Out-Null
  Invoke-Control $root 'Juegos'
  Find-Control $root 'Reflejos' $true | Out-Null
  Invoke-Control $root 'Clasificación'
  Find-Control $root 'Ranking arcade' | Out-Null
  Invoke-Control $root 'Preferencias'
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
  $nick = Find-TypedControl $root 'Tu apodo' ([System.Windows.Automation.ControlType]::Edit)
  $nick.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('Prueba')
  $name = Find-TypedControl $root 'Nombre de la sala' ([System.Windows.Automation.ControlType]::Edit)
  $name.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('Canal de prueba')
  $submit = Find-TypedControl $root 'Crear sala' ([System.Windows.Automation.ControlType]::Button)
  $submit.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Find-Control $root 'Participantes' | Out-Null
  Measure-Idle 'en-sala-sin-microfono'
  Invoke-Control $root 'Juegos'
  Find-Control $root 'Reflejos' $true | Out-Null
  Find-Control $root 'Canal de prueba' | Out-Null
  Invoke-Control $root 'Voz'
  Start-Sleep -Seconds 4
  if (!(Find-Control $root 'Salir de sala').Current.IsEnabled) { throw 'Se perdió la llamada al volver al directorio.' }
  Invoke-Control $root 'Salir de sala'
  Find-Control $root 'Sin sala' | Out-Null
  Write-Output 'Verificados directorio, grupos, secciones, perfil, clasificación, audio y entrada por código.'
} finally {
  if ($app -and !$app.HasExited) { $app.Kill(); $app.WaitForExit() }
  if (!$serverProcess.HasExited) { $serverProcess.Kill(); $serverProcess.WaitForExit() }
}
