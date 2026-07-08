<#
.SYNOPSIS
    Deploys the static website in www/ to the production web server.

.DESCRIPTION
    Uploads the contents of www/ (landing page, privacy policy, terms) to the
    remote web root via scp, then verifies each page over HTTPS.

    Server connection details are NOT stored in this (versioned) script. They are
    read from .release.env (git-ignored), same as release_extension.ps1. Required keys:

        WEB_DEPLOY_HOST   e.g. 203.0.113.10 or host.example.com
        WEB_DEPLOY_USER   e.g. deploy
        WEB_DEPLOY_PATH   e.g. /var/www/example.com/public/app
        WEB_URL           e.g. https://example.com/app   (used only for the post-deploy check)

.PARAMETER VerifyFile
    Optional path to an extra file to upload alongside the site — e.g. a Google
    Search Console verification file (googleXXXX.html). Uploaded verbatim.

.EXAMPLE
    ./deploy_website.ps1
    ./deploy_website.ps1 -VerifyFile .\google1a2b3c4d.html
#>
param(
    [string]$VerifyFile
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Import-ReleaseEnv {
    $envPath = Join-Path $PSScriptRoot ".release.env"
    if (!(Test-Path $envPath)) {
        throw ".release.env not found. Copy .release.env.example to .release.env and fill in WEB_DEPLOY_* keys."
    }
    Get-Content -Path $envPath | ForEach-Object {
        $line = $_.Trim()
        if (!$line -or $line.StartsWith("#")) { return }
        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) { return }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($name) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
    }
}

function Require-Env($name) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (!$value) { throw "$name is missing. Set it in .release.env." }
    return $value
}

Import-ReleaseEnv
$deployHost = Require-Env "WEB_DEPLOY_HOST"
$deployUser = Require-Env "WEB_DEPLOY_USER"
$deployPath = Require-Env "WEB_DEPLOY_PATH"
$webUrl = [Environment]::GetEnvironmentVariable("WEB_URL", "Process")

$sshOpts = @("-o", "StrictHostKeyChecking=accept-new")
$target = "$deployUser@$deployHost"

# Collect site files to upload.
$wwwDir = Join-Path $PSScriptRoot "www"
$files = Get-ChildItem -Path $wwwDir -File | Where-Object { $_.Extension -in ".html", ".css", ".js", ".ico", ".png", ".jpg", ".jpeg", ".svg", ".txt", ".webp" }
if (-not $files) { throw "No files found in www/." }

Write-Step "Uploading $($files.Count) file(s) from www/ to ${target}:$deployPath"
$paths = $files.FullName
& scp @sshOpts @paths "${target}:$deployPath/"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)." }

if ($VerifyFile) {
    if (!(Test-Path $VerifyFile)) { throw "VerifyFile not found: $VerifyFile" }
    Write-Step "Uploading verification file: $VerifyFile"
    & scp @sshOpts $VerifyFile "${target}:$deployPath/"
    if ($LASTEXITCODE -ne 0) { throw "scp of verification file failed (exit $LASTEXITCODE)." }
}

if ($webUrl) {
    Write-Step "Verifying pages over HTTPS ($webUrl)"
    $checks = @("index.html", "privacy.html", "terms.html")
    $remoteCmd = ($checks | ForEach-Object {
        "curl -sS -o /dev/null -w '$_ %{http_code}\n' $webUrl/$_"
    }) -join "; "
    & ssh @sshOpts $target $remoteCmd
}

Write-Step "Website deploy complete."
