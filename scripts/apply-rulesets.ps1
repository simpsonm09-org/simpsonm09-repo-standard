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

$existing = @()
foreach ($line in (& gh api "repos/$Repo/rulesets" --jq '.[] | [.id, .name] | @tsv')) {
    if (-not $line) { continue }
    $parts = $line -split "`t"
    $existing += [pscustomobject]@{ Id = $parts[0]; Name = $parts[1] }
}

foreach ($file in Get-ChildItem -LiteralPath $rulesetDir -Filter '*.json') {
    $data = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $match = $existing | Where-Object { $_.Name -eq $data.name } | Select-Object -First 1
    if (-not $Apply) {
        if ($match) { Write-Host "would update $($data.name)" } else { Write-Host "would create $($data.name)" }
        continue
    }
    if ($match) {
        & gh api -X PUT "repos/$Repo/rulesets/$($match.Id)" --input $file.FullName | Out-Null
        Write-Host "updated $($data.name)"
    } else {
        & gh api -X POST "repos/$Repo/rulesets" --input $file.FullName | Out-Null
        Write-Host "created $($data.name)"
    }
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply $($file.Name)" }
}
