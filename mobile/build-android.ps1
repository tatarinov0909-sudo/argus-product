param([string]$ApiBase = 'http://10.0.2.2:3110')
$ErrorActionPreference = 'Stop'
$argusRoot = Split-Path -Parent $PSScriptRoot
$argusTools = Join-Path $argusRoot '.tools'
$argusJdk = Join-Path $argusTools 'jdk-21'
$argusSdk = Join-Path $argusTools 'android-sdk'
$argusGradle = Join-Path $argusTools 'gradle-8.14.3/bin/gradle.bat'
if (Test-Path -LiteralPath $argusJdk) { $env:JAVA_HOME = $argusJdk }
if (Test-Path -LiteralPath $argusSdk) { $env:ANDROID_HOME = $argusSdk }
if (Test-Path -LiteralPath $argusTools) { $env:GRADLE_USER_HOME = Join-Path $argusTools 'gradle-user-home' }
$env:ARGUS_API_BASE = $ApiBase
Push-Location -LiteralPath $PSScriptRoot
try {
    & npm.cmd run sync
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить ресурсы Android' }
    Set-Location -LiteralPath (Join-Path $PSScriptRoot 'android')
    if (!(Test-Path -LiteralPath $argusGradle)) { $argusGradle = Join-Path $PSScriptRoot 'android/gradlew.bat' }
    & $argusGradle ':app:assembleDebug' --no-daemon --max-workers=2
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать Android APK' }
    $argusOutput = Join-Path $PSScriptRoot 'output'
    New-Item -ItemType Directory -Path $argusOutput -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $argusOutput 'argus-worker-0.1.0-stand.apk')
    Write-Output "Тестовый APK: $argusOutput/argus-worker-0.1.0-stand.apk"
} finally { Pop-Location }
