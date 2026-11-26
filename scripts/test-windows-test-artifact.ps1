$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-test-artifact.ps1')

$fixture = Join-Path ([System.IO.Path]::GetTempPath()) "voyalier-test-artifact-$([guid]::NewGuid().ToString('N'))"
$target = Join-Path $fixture 'target'
$triple = 'x86_64-pc-windows-msvc'
$hash = '76f55c6bb4a14628'
$junction = Join-Path $target "release/build/voyalier-desktop/$hash/out"

function New-ArtifactFixture {
    param([string]$Root, [string]$Relative)
    $file = Join-Path $Root $Relative
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($file))
    [System.IO.File]::WriteAllText($file, 'admission test fixture')
    return [System.IO.Path]::GetFullPath($file)
}

function Assert-Rejected {
    param([string]$Executable, [string]$Reason)
    try {
        [void](Resolve-DesktopTestArtifact $target $triple $Executable)
    } catch {
        if ($_.Exception.Message -notlike "*$Reason*") { throw }
        return
    }
    throw "The runner unexpectedly accepted $Executable"
}

try {
    $binaryHash = '4fd0860bc56af057'
    $fixtures = @(
        "debug/deps/voyalier_desktop-$hash.exe",
        "$triple/release/deps/voyalier_desktop_lib-$hash.exe",
        "debug/build/voyalier-desktop/$hash/out/voyalier_desktop_lib-$hash.exe",
        "debug/build/voyalier-desktop/$binaryHash/out/voyalier_desktop-$binaryHash.exe",
        "$triple/release/build/voyalier-desktop/$hash/out/voyalier_desktop_lib-$hash.exe"
    )
    foreach ($path in $fixtures) {
        $artifact = New-ArtifactFixture $target $path
        if ((Resolve-DesktopTestArtifact $target $triple $artifact) -cne $artifact) {
            throw "The runner changed the Cargo artifact path $artifact"
        }
    }

    $wrongLayouts = @(
        "debug/build/other-package/$hash/out/voyalier_desktop_lib-$hash.exe",
        "debug/build/voyalier-desktop/$hash/out/voyalier_desktop_lib-76434366ab4e22b2.exe",
        "debug/build/voyalier-desktop/$hash/out/voyalier_desktop_tool-$hash.exe",
        "other/debug/deps/voyalier_desktop_lib-$hash.exe",
        "aarch64-pc-windows-msvc/debug/deps/voyalier_desktop_lib-$hash.exe"
    )
    foreach ($path in $wrongLayouts) {
        Assert-Rejected (New-ArtifactFixture $target $path) 'supported Cargo layout'
    }
    Assert-Rejected (New-ArtifactFixture "${target}-other" $fixtures[0]) 'inside the Cargo target root'
    Assert-Rejected "$target/debug/deps/../deps/voyalier_desktop-$hash.exe" 'absolute Cargo target root'
    $directory = Join-Path $target "release/deps/voyalier_desktop-$hash.exe"
    [void][System.IO.Directory]::CreateDirectory($directory)
    Assert-Rejected $directory 'must be a file'

    $elsewhere = New-ArtifactFixture $fixture "elsewhere/voyalier_desktop_lib-$hash.exe"
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($junction))
    [void](New-Item -ItemType Junction -Path $junction -Target ([System.IO.Path]::GetDirectoryName($elsewhere)))
    Assert-Rejected (Join-Path $junction "voyalier_desktop_lib-$hash.exe") 'must not be reparse points'
    $binary = "voyalier_desktop-$binaryHash.exe"
    $library = "voyalier_desktop_lib-$hash.exe"
    $emptyList = "`r`n0 tests, 0 benchmarks`r`n"
    if (-not (Test-DesktopHarnessList $binary 0 $emptyList) -or
        (Test-DesktopHarnessList $library 0 $emptyList) -or
        (Test-DesktopHarnessList $binary 1 $emptyList) -or
        (Test-DesktopHarnessList $binary 0 '') -or
        -not (Test-DesktopHarnessList $library 0 "fixture::example: test`r`n")) {
        throw 'The runner misidentified a desktop harness result'
    }
    Write-Host 'Windows desktop test artifact admission checks passed'
}
finally {
    if ([System.IO.Directory]::Exists($junction)) { [System.IO.Directory]::Delete($junction) }
    if ([System.IO.Directory]::Exists($fixture)) { [System.IO.Directory]::Delete($fixture, $true) }
}
