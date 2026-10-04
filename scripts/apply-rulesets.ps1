[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Position = 0)][string] $Repo,
    [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-Usage { Write-Host 'usage: apply-rulesets.ps1 -Repo <owner/repo> [-Apply]' }

if ($Repo -in @('help', '-h', '--help')) {
    Show-Usage
    exit 0
}
if ([string]::IsNullOrWhiteSpace($Repo)) {
    Show-Usage
    exit 2
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$rulesetDir = Join-Path $repoRoot 'rulesets'

$visibility = (& gh api "repos/$Repo" --jq .visibility)
if ($LASTEXITCODE -ne 0) { throw "Could not read $Repo. Check gh authentication." }

if ($visibility -ne 'public') {
    Write-Host "$Repo is $visibility. Rulesets stay unenforced until the repository is public."
    Get-ChildItem -LiteralPath $rulesetDir -Filter '*.json' | ForEach-Object {
        Write-Host "  would apply $($_.Name)"
    }
    return
}

# The repository's agent access level decides whether the App joins the bypass
# list. The App id comes from the environment, then the captured app metadata.
$short = $Repo.Split('/')[-1]
$level = (& node (Join-Path $repoRoot 'scripts/agent-access.mjs') $short 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($level)) { $level = 'read' }
$level = $level.Trim()

$appId = $env:AGENT_APP_ID
if ([string]::IsNullOrWhiteSpace($appId)) {
    $metaPath = Join-Path $HOME '.config/simpsonm09/agent-app.json'
    if (Test-Path -LiteralPath $metaPath) {
        $appId = (Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json).id
    }
}

$existing = @()
foreach ($line in (& gh api "repos/$Repo/rulesets" --jq '.[] | [.id, .name] | @tsv')) {
    if (-not $line) { continue }
    $parts = $line -split "`t"
    $existing += [pscustomobject]@{ Id = $parts[0]; Name = $parts[1] }
}

foreach ($file in Get-ChildItem -LiteralPath $rulesetDir -Filter '*.json') {
    $payloadArgs = @($file.FullName, '--level', $level)
    if (-not [string]::IsNullOrWhiteSpace($appId)) { $payloadArgs += @('--app-id', $appId) }
    $payloadFile = [System.IO.Path]::GetTempFileName()
    & node (Join-Path $repoRoot 'scripts/ruleset-payload.mjs') @payloadArgs | Set-Content -LiteralPath $payloadFile
    if ($LASTEXITCODE -ne 0) { throw "Failed to build the payload for $($file.Name)" }

    $data = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $match = $existing | Where-Object { $_.Name -eq $data.name } | Select-Object -First 1
    if (-not $Apply) {
        if ($match) { Write-Host "would update $($data.name)" } else { Write-Host "would create $($data.name)" }
        Remove-Item -LiteralPath $payloadFile -Force
        continue
    }
    if ($match) {
        & gh api -X PUT "repos/$Repo/rulesets/$($match.Id)" --input $payloadFile | Out-Null
        Write-Host "updated $($data.name)"
    } else {
        & gh api -X POST "repos/$Repo/rulesets" --input $payloadFile | Out-Null
        Write-Host "created $($data.name)"
    }
    Remove-Item -LiteralPath $payloadFile -Force
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply $($file.Name)" }
}
