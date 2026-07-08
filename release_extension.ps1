param(
    [ValidateSet("major", "minor", "patch")]
    [string]$VersionType = "patch",
    [switch]$UseExistingVersion,
    [switch]$SkipPublish,
    [switch]$SkipChangelogCommit
)

$ErrorActionPreference = "Stop"

function Read-JsonFile($path) {
    return Get-Content -Path $path -Raw | ConvertFrom-Json
}

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Require-CleanGitTree {
    $status = git status --short
    if ($status) {
        throw "Working tree is not clean.`n$status"
    }
}

function Import-ReleaseEnv {
    $envPath = Join-Path $PSScriptRoot ".release.env"
    if (!(Test-Path $envPath)) {
        return
    }

    Get-Content -Path $envPath | ForEach-Object {
        $line = $_.Trim()
        if (!$line -or $line.StartsWith("#")) {
            return
        }

        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) {
            return
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($name) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Get-NextVersion([string]$currentVersion, [string]$versionType) {
    $parts = $currentVersion.Split(".")
    if ($parts.Count -ne 3) {
        throw "Unexpected package version format: $currentVersion"
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($versionType) {
        "major" { return "$($major + 1).0.0" }
        "minor" { return "$major.$($minor + 1).0" }
        "patch" { return "$major.$minor.$($patch + 1)" }
    }
}

function Update-ChangelogVersion([string]$nextVersion) {
    $path = Join-Path $PSScriptRoot "CHANGELOG.md"
    $content = Get-Content -Path $path -Raw
    $updated = $content -replace "## \[\s*upcoming\s*\]", "## [$nextVersion]"

    if ($updated -eq $content) {
        Write-Host "No [ upcoming ] changelog header found; leaving CHANGELOG.md unchanged."
        return $false
    }

    Set-Content -Path $path -Value $updated -NoNewline -Encoding UTF8
    return $true
}

Set-Location $PSScriptRoot
Import-ReleaseEnv

Write-Step "Checking git state"
Require-CleanGitTree

$package = Read-JsonFile (Join-Path $PSScriptRoot "package.json")
$currentVersion = [string]$package.version

if ($UseExistingVersion) {
    $version = $currentVersion
    Write-Step "Using existing version $version"
} else {
    $nextVersion = Get-NextVersion $currentVersion $VersionType
    Write-Step "Preparing changelog for $nextVersion"
    $changelogChanged = Update-ChangelogVersion $nextVersion
    if ($changelogChanged -and !$SkipChangelogCommit) {
        git add CHANGELOG.md
        git commit -m "chore: prepare $nextVersion changelog"
        git push origin (git branch --show-current)
    }

    Write-Step "Bumping npm version ($VersionType)"
    npm version $VersionType
    $package = Read-JsonFile (Join-Path $PSScriptRoot "package.json")
    $version = [string]$package.version
}

Write-Step "Building VSIX"
& (Join-Path $PSScriptRoot "build_extension.ps1")

$vsix = Join-Path $PSScriptRoot "mail-client-vscode-$version.vsix"
if (!(Test-Path $vsix)) {
    throw "Expected VSIX not found: $vsix"
}

Write-Step "Pushing git commits and tags"
git push --follow-tags

if ($SkipPublish) {
    Write-Host "SkipPublish set; leaving VSIX unpublished: $vsix"
    exit 0
}

if (!$env:OVSX_PAT) {
    throw "OVSX_PAT is missing. Set it in the environment or in local .release.env."
}

Write-Step "Publishing to Open VSX"
npx --yes ovsx publish $vsix

Write-Step "Publishing to VS Code Marketplace"
npx --yes vsce publish --packagePath $vsix

Write-Step "Release $version complete"
