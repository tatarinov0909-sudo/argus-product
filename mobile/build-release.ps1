param([string]$OutputApk)
$ErrorActionPreference = 'Stop'
$argusRoot = Split-Path -Parent $PSScriptRoot
$argusTools = Join-Path $argusRoot '.tools'
$argusJdk = Join-Path $argusTools 'jdk-21'
$argusSdk = Join-Path $argusTools 'android-sdk'
$argusGradle = Join-Path $argusTools 'gradle-8.14.3/bin/gradle.bat'
if (!$OutputApk) { $OutputApk = Join-Path $PSScriptRoot 'output/argus-worker-0.1.0.apk' }
if (Test-Path -LiteralPath $OutputApk) { throw 'Release output already exists. Choose a new path; published releases must not be overwritten.' }
if (Test-Path -LiteralPath $argusJdk) { $env:JAVA_HOME = $argusJdk }
if (Test-Path -LiteralPath $argusSdk) { $env:ANDROID_HOME = $argusSdk }
if (Test-Path -LiteralPath $argusTools) { $env:GRADLE_USER_HOME = Join-Path $argusTools 'gradle-user-home' }
$previousApi = $env:ARGUS_API_BASE
$env:ARGUS_API_BASE = 'https://api.argus-ai.online'
Push-Location -LiteralPath $PSScriptRoot
try {
    & npm.cmd run sync
    if ($LASTEXITCODE -ne 0) { throw 'Android production assets could not be prepared.' }
    Set-Location -LiteralPath (Join-Path $PSScriptRoot 'android')
    if (!(Test-Path -LiteralPath $argusGradle)) { $argusGradle = Join-Path $PSScriptRoot 'android/gradlew.bat' }
    & $argusGradle ':app:assembleRelease' --no-daemon --max-workers=2
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
    & (Join-Path $PSScriptRoot 'sign-release.ps1') -UnsignedApk (Join-Path $PSScriptRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk') -OutputApk $OutputApk
} finally {
    Pop-Location
    $env:ARGUS_API_BASE = $previousApi
}
