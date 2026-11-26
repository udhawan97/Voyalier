function Resolve-DesktopTestArtifact {
    param([string]$TargetRoot, [string]$TestTarget, [string]$Executable)

    if (-not [System.IO.Path]::IsPathFullyQualified($TargetRoot) -or
        -not [System.IO.Path]::IsPathFullyQualified($Executable) -or
        $TestTarget -notmatch '\A[A-Za-z0-9_-]+-windows-msvc\z' -or
        $Executable -match '(?:^|[\\/])\.\.?(?:[\\/]|$)') {
        throw 'Expected an absolute Cargo target root and desktop test artifact for a Windows MSVC target'
    }

    $absolute = [System.IO.Path]::GetFullPath($Executable)
    $target = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'The desktop test artifact must be inside the Cargo target root'
    }

    $relative = $absolute.Substring($target.Length) -replace '\\', '/'
    $profile = '(?:' + [regex]::Escape($TestTarget) + '/)?(?:debug|release)/'
    # Cargo can run the lib test directly out of the package's build directory.
    # Its directory and executable must carry the same Cargo artifact hash.
    $deps = '\A' + $profile + 'deps/voyalier_desktop(?:_lib)?-[0-9a-f]{16}\.exe\z'
    $out = '\A' + $profile + 'build/voyalier-desktop/(?<hash>[0-9a-f]{16})/out/voyalier_desktop_lib-\k<hash>\.exe\z'
    if ($relative -notmatch $deps -and $relative -notmatch $out) {
        throw 'The runner accepts only exact hashed desktop test artifacts in a supported Cargo layout'
    }

    $attributes = [System.IO.File]::GetAttributes($absolute)
    if ($attributes -band [System.IO.FileAttributes]::Directory) {
        throw 'The desktop test artifact must be a file'
    }
    for ($path = $absolute; $path; $path = [System.IO.Path]::GetDirectoryName($path)) {
        if ([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::ReparsePoint) {
            throw 'The desktop test artifact and its parent directories must not be reparse points'
        }
    }
    return $absolute
}
