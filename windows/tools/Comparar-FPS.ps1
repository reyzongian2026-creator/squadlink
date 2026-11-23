#requires -Version 5.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$ConLlamada
)
$ErrorActionPreference = 'Stop'

function Measure-Capture([string]$Path) {
    $chains = @{}
    $firstRow = $true
    $hasFrameType = $false
    Import-Csv -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        if ($firstRow) {
            $columns = $_.PSObject.Properties.Name
            foreach ($required in 'Application', 'ProcessID', 'SwapChainAddress', 'FrameTime') {
                if ($columns -notcontains $required) {
                    throw "Falta la columna $required en '$Path'. Usa un CSV de PresentMon con metricas v2."
                }
            }
            $hasFrameType = $columns -contains 'FrameType'
            $firstRow = $false
        }
        if ($_.Application -ine 'VALORANT-Win64-Shipping.exe') { return }
        if ($hasFrameType -and $_.FrameType -ine 'Application') { return }
        if ([string]::IsNullOrWhiteSpace($_.ProcessID) -or [string]::IsNullOrWhiteSpace($_.SwapChainAddress)) { return }
        [double]$ms = 0
        if (![double]::TryParse($_.FrameTime, [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$ms)) { return }
        if ($ms -le 0 -or [double]::IsNaN($ms) -or [double]::IsInfinity($ms)) { return }

        $key = "$($_.ProcessID)/$($_.SwapChainAddress)"
        if (!$chains.ContainsKey($key)) { $chains[$key] = New-Object 'System.Collections.Generic.List[double]' }
        $chains[$key].Add($ms)
    }
    if ($chains.Count -eq 0) { throw "Sin intervalos validos de VALORANT-Win64-Shipping.exe en '$Path'." }
    $ordered = @($chains.GetEnumerator() | Sort-Object -Property { $_.Value.Count } -Descending)
    if ($ordered.Count -gt 1 -and $ordered[0].Value.Count -eq $ordered[1].Value.Count) {
        throw "Dos cadenas tienen el mismo numero de fotogramas en '$Path'. Repite la captura con una sola partida activa."
    }
    $samples = $ordered[0].Value
    Write-Verbose "$Path | PID/SwapChainAddress $($ordered[0].Key) | $($samples.Count) intervalos validos"
    $samples.Sort()
    $sum = ($samples | Measure-Object -Sum).Sum
    $rank = [int][Math]::Ceiling(0.99 * $samples.Count) - 1
    [pscustomobject]@{
        Count = $samples.Count
        Fps = (1000.0 * $samples.Count / $sum)
        P99 = $samples[$rank]
    }
}

function New-ResultRow([string]$Label, $Count, [double]$Fps, [double]$P99) {
    [pscustomobject]@{
        Escenario = $Label
        Intervalos = $Count
        FPS = [Math]::Round($Fps, 2)
        P99ms = [Math]::Round($P99, 2)
    }
}

$solo = Measure-Capture $Base
$call = Measure-Capture $ConLlamada
New-ResultRow 'Base' $solo.Count $solo.Fps $solo.P99
New-ResultRow 'Con llamada' $call.Count $call.Fps $call.P99
New-ResultRow 'Diferencia' $null ($call.Fps - $solo.Fps) ($call.P99 - $solo.P99)
