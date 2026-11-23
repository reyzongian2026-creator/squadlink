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
try {
  $ready = $false
  for ($i=0; $i -lt 40 -and !$ready; $i++) {
    try { $ready = (Invoke-WebRequest 'http://127.0.0.1:4179/api/directory' -TimeoutSec 2).StatusCode -eq 200 }
    catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$ready) { throw 'El servidor de prueba no arrancó.' }
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
  Find-Control $root 'Crear sala' | Out-Null
  $checks = [ordered]@{'Amigos'='Elegir mi apodo'; 'Arcade'='Arcade'; 'Mi jugador'='Editar mi apodo'; 'Ajustes'='Ajustes de voz'; 'Explorar salas'='Actualizar'; 'Mi sala'='Unirme con código'}
  foreach ($entry in $checks.GetEnumerator()) {
    $button = Find-Control $root $entry.Key
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    if ($entry.Key -eq 'Arcade') { Find-Control $root 'Reflejos' $true | Out-Null }
    else { Find-Control $root $entry.Value | Out-Null }
  }
  Write-Output 'Se verificaron el arranque y las seis vistas del instalador en Windows.'
} finally {
  if ($app -and !$app.HasExited) { $app.Kill(); $app.WaitForExit() }
  if (!$serverProcess.HasExited) { $serverProcess.Kill(); $serverProcess.WaitForExit() }
}
