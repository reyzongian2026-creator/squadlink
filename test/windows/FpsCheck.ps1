#requires -Version 5.0
$ErrorActionPreference = 'Stop'
$tool = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'windows/tools/Comparar-FPS.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
$null = New-Item -ItemType Directory -Path $work

# PresentMon v2.3.0 Tests/Gold/test_case_0.csv header. Values below are synthetic.
$header = 'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,FrameType,CPUStartQPC,FrameTime,CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait,VideoBusy,DisplayLatency,DisplayedTime,AnimationError,AnimationTime,AllInputToPhotonLatency,ClickToPhotonLatency,InstrumentedLatency'
function New-Frame([string]$Ms, [string]$Chain, [string]$ProcessId = '3172',
        [string]$Image = 'VALORANT-Win64-Shipping.exe', [string]$Type = 'Application') {
    "$Image,$ProcessId,$Chain,DXGI,1,0,0,Hardware: Independent Flip,$Type,2076511276,$Ms,7.2500,0.0893,0.8529,6.5144,1.0752,5.4392,0.0000,32.7296,33.3323,0.0000,332.7030,NA,NA,NA"
}
function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -ne $Expected) { throw "$Label -- esperado: $Expected, obtenido: $Actual" }
}
function Assert-Rejected([string]$Path, [string]$Message) {
    try { $null = & $tool -Base $Path -ConLlamada $Path }
    catch {
        if ($_.Exception.Message -notlike "*$Message*") { throw }
        return
    }
    throw "La entrada de prueba se acepto: $Message"
}
try {
    $base = Join-Path $work 'base.csv'
    $call = Join-Path $work 'llamada.csv'
    @(
        $header
        1..99 | ForEach-Object { New-Frame '10.0000' '0xAAAA' }
        New-Frame '50.0000' '0xAAAA'
        1..90 | ForEach-Object { New-Frame '30.0000' '0xBBBB' }
        1..90 | ForEach-Object { New-Frame '40.0000' '0xBBBB' '3173' }
        New-Frame '600' '0xAAAA' '3172' 'VALORANT.exe'
        New-Frame '400' '0xAAAA' '3172' 'VALORANT-Win64-Shipping.exe.bak'
        New-Frame '300' '0xAAAA' '3172' 'VALORANT-Win64-Shipping.exe' 'Intel XeSS-FG'
        foreach ($bad in 'NA', '0', '-1', 'NaN', 'Infinity', '-Infinity') { New-Frame $bad '0xAAAA' }
    ) | Set-Content -LiteralPath $base -Encoding UTF8
    @(
        $header
        1..98 | ForEach-Object { New-Frame '12.0000' '0xCCCC' }
        New-Frame '35.0000' '0xCCCC'
        New-Frame '35.0000' '0xCCCC'
    ) | Set-Content -LiteralPath $call -Encoding UTF8
    $result = @(& $tool -Base $base -ConLlamada $call)
    Assert-Equal $result.Count 3 'Filas del informe'
    Assert-Equal $result[0].Intervalos 100 'Seleccion del proceso, cadena y muestras finitas'
    Assert-Equal $result[0].FPS 96.15 'FPS medios ponderados por tiempo'
    Assert-Equal $result[0].P99ms 10 'P99 de la base'
    Assert-Equal $result[1].FPS 80.26 'FPS con llamada'
    Assert-Equal $result[1].P99ms 35 'P99 con llamada'
    Assert-Equal $result[2].FPS (-15.9) 'Diferencia de FPS antes de redondear'
    Assert-Equal $result[2].P99ms 25 'Diferencia del P99'

    $other = Join-Path $work 'otro.csv'
    @('Application,ProcessID,SwapChainAddress,FrameTime','VALORANT-Win64-Shipping.exe,1072,0x1234,12.5') |
        Set-Content -LiteralPath $other -Encoding UTF8
    $simple = @(& $tool -Base $other -ConLlamada $other)
    Assert-Equal $simple[0].FPS 80 'CSV sin columna opcional FrameType'
    'VALORANT-Win64-Shipping.exe,1072,0x5678,12.5' | Add-Content -LiteralPath $other -Encoding UTF8
    Assert-Rejected $other 'mismo numero'
    @('Application,ProcessID,SwapChainAddress,FrameTime','dwm.exe,4120,0x1000,16.7') |
        Set-Content -LiteralPath $other -Encoding UTF8
    Assert-Rejected $other 'Sin intervalos'
    @('Application,ProcessID,SwapChainAddress,MsBetweenPresents','VALORANT-Win64-Shipping.exe,1072,0x1234,12.5') |
        Set-Content -LiteralPath $other -Encoding UTF8
    Assert-Rejected $other 'Falta la columna FrameTime'
    Write-Output 'Comparador de FPS verificado con muestras sinteticas PresentMon v2.'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
