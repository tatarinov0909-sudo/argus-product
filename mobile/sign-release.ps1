param(
    [Parameter(Mandatory = $true)][string]$UnsignedApk,
    [Parameter(Mandatory = $true)][string]$OutputApk,
    [string]$SigningDirectory = (Join-Path $env:USERPROFILE '.codex/private/argus-worker-signing'),
    [string]$JavaDirectory,
    [string]$BuildToolsDirectory
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$expectedFingerprint = '3981f1a257a744accf587beabaa2f2d880427a4ed674bc0406d31daf37091e6f'
$repoRoot = Split-Path $PSScriptRoot -Parent
if (!$JavaDirectory) { $JavaDirectory = Join-Path $repoRoot '.tools/jdk-21' }
if (!$BuildToolsDirectory) { $BuildToolsDirectory = Join-Path $repoRoot '.tools/android-sdk/build-tools/35.0.0' }
$inputPath = (Resolve-Path -LiteralPath $UnsignedApk).Path
$outputPath = [IO.Path]::GetFullPath($OutputApk)
if (Test-Path -LiteralPath $outputPath) { throw 'Output already exists. Choose a new release filename; nothing was overwritten.' }
if ($inputPath -eq $outputPath) { throw 'Unsigned input and signed output must be different files.' }
$outputDirectory = Split-Path $outputPath -Parent
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$alignedPath = Join-Path $outputDirectory ('.argus-aligned-' + [Guid]::NewGuid().ToString('N') + '.apk')
$apksigner = Join-Path $BuildToolsDirectory 'apksigner.bat'
$zipalign = Join-Path $BuildToolsDirectory 'zipalign.exe'
$aapt = Join-Path $BuildToolsDirectory 'aapt2.exe'
$metadata = Get-Content -LiteralPath (Join-Path $SigningDirectory 'signing.json') -Raw | ConvertFrom-Json
if ($metadata.package -ne 'online.argus.worker' -or $metadata.certificateSha256 -ne $expectedFingerprint) { throw 'The signing identity does not match this application.' }
$keystore = Join-Path $SigningDirectory $metadata.keystoreFile
foreach ($file in @($apksigner, $zipalign, $aapt, $keystore, (Join-Path $JavaDirectory 'bin/java.exe'))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required signing tool or keystore is missing: $file" }
}
$previousJava = $env:JAVA_HOME
$previousSecret = $env:ARGUS_SIGNING_PASSWORD
$secure = $null
$secretPointer = [IntPtr]::Zero
try {
    $env:JAVA_HOME = $JavaDirectory
    $badging = (& $aapt dump badging $inputPath 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='online\.argus\.worker'" -or $badging -match 'application-debuggable') {
        throw 'Only a non-debuggable online.argus.worker release APK may be signed.'
    }
    $existingSignature = & $apksigner verify $inputPath 2>&1
    if ($LASTEXITCODE -eq 0) { throw 'Input APK is already signed. Provide the unsigned release APK.' }
    # Public build metadata prevents accidentally signing the localhost test application.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($inputPath)
    try {
        $entry = $archive.GetEntry('assets/public/build-info.json')
        if (!$entry) { throw 'Release build metadata is missing.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $build = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($build.native -ne $true -or $build.environment -ne 'production') { throw 'Build the Android assets for the production API before signing.' }
    } finally { $archive.Dispose() }
    & $zipalign -P 16 4 $inputPath $alignedPath
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    $secure = Get-Content -LiteralPath (Join-Path $SigningDirectory 'password.dpapi') -Raw | ConvertTo-SecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:ARGUS_SIGNING_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    & $apksigner sign --ks $keystore --ks-key-alias $metadata.alias --ks-pass env:ARGUS_SIGNING_PASSWORD --key-pass env:ARGUS_SIGNING_PASSWORD --v4-signing-enabled false --out $outputPath $alignedPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed; do not publish the output.' }
    $verification = (& $apksigner verify --verbose --print-certs $outputPath 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed; do not publish the output.' }
    $match = [regex]::Match($verification, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
    if (!$match.Success -or $match.Groups[1].Value.ToLowerInvariant() -ne $expectedFingerprint) { throw 'Signed APK certificate does not match the pinned release certificate.' }
    & $zipalign -c -P 16 4 $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    [PSCustomObject]@{ Apk = $outputPath; Package = 'online.argus.worker'; CertificateSha256 = $expectedFingerprint; ApkSha256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant() }
} finally {
    $env:ARGUS_SIGNING_PASSWORD = $previousSecret
    $env:JAVA_HOME = $previousJava
    if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    if ($secure) { $secure.Dispose() }
    # The only cleanup target is this invocation's uniquely named file in the output directory.
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($alignedPath)) -eq [IO.Path]::GetFullPath($outputDirectory) -and (Test-Path -LiteralPath $alignedPath)) {
        Remove-Item -LiteralPath $alignedPath
    }
}
