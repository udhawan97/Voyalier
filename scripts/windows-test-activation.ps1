param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('debug', 'release')]
    [string]$BuildProfile,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$Package
)

$ErrorActionPreference = 'Stop'
$entrypointNotFound = -1073741511 # 0xc0000139

function Invoke-Captured {
    param([string]$Executable, [string[]]$Arguments, [int]$Timeout = 30000)
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($Timeout -eq 0) { $process.WaitForExit() }
        elseif (-not $process.WaitForExit($Timeout)) {
            $process.Kill()
            $process.WaitForExit()
            throw "Native diagnostic exceeded its time limit: $Executable"
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $stdout.GetAwaiter().GetResult()
            Error = $stderr.GetAwaiter().GetResult()
        }
    }
    finally { $process.Dispose() }
}

function Read-Manifest {
    param([string]$Tool, [string]$Executable, [string]$OutputPath)
    $result = Invoke-Captured $Tool @('-nologo', "-inputresource:$Executable;#1", "-out:$OutputPath")
    if ($result.ExitCode -ne 0) {
        if (($result.Output + $result.Error) -notmatch 'resource (type|name) cannot be found|image file did not contain a resource section') {
            throw "Manifest extraction failed: $($result.Output) $($result.Error)"
        }
        return $null
    }
    $document = [System.Xml.XmlDocument]::new()
    $document.XmlResolver = $null
    $document.Load($OutputPath)
    return ,$document
}

function Has-ControlsV6 {
    param($Document)
    if ($null -eq $Document) { return $false }
    return $null -ne $Document.SelectSingleNode(
        "//*[local-name()='dependentAssembly']/*[local-name()='assemblyIdentity' and @name='Microsoft.Windows.Common-Controls' and @version='6.0.0.0']"
    )
}

function Add-ControlsDependency {
    param([string]$Tool, [string]$Executable, [string]$Dependency, [bool]$HasManifest)
    $arguments = @('-nologo')
    if ($HasManifest) { $arguments += "-inputresource:$Executable;#1" }
    $arguments += @('-manifest', $Dependency, "-outputresource:$Executable;#1")
    $result = Invoke-Captured $Tool $arguments
    if ($result.ExitCode -ne 0) {
        throw "Test manifest merge failed: $($result.Output) $($result.Error)"
    }
}

Write-Host "[test-activation] profile=$BuildProfile source-sha256=$((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash)"
$cargo = (Get-Command cargo -ErrorAction Stop).Source
$arguments = @('test', '--locked', '-p', $Package, '--no-run', '--message-format=json')
if ($BuildProfile -eq 'release') { $arguments += '--release' }
$compiled = Invoke-Captured $cargo $arguments 0
if ($compiled.Error) { Write-Host $compiled.Error }
if ($compiled.ExitCode -ne 0) {
    Write-Host $compiled.Output
    throw "Cargo test compilation failed with exit code $($compiled.ExitCode)"
}
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'target' }
$target = [System.IO.Path]::GetFullPath($target).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$executables = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($line in $compiled.Output -split "`n") {
    if (-not $line.Trim()) { continue }
    $artifact = $line | ConvertFrom-Json -ErrorAction Stop
    if ($artifact.reason -eq 'compiler-message' -and $artifact.message.rendered) {
        Write-Host $artifact.message.rendered
    }
    if ($artifact.reason -ne 'compiler-artifact' -or -not $artifact.profile.test -or -not $artifact.executable) { continue }
    $executable = [System.IO.Path]::GetFullPath($artifact.executable)
    if (-not $executable.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetExtension($executable) -ne '.exe') {
        throw 'Cargo returned a test executable outside its target directory'
    }
    [void]$executables.Add($executable)
}
if ($executables.Count -eq 0) { throw 'Cargo returned no test executables' }

foreach ($executable in $executables) {
    if ([System.IO.File]::GetAttributes($executable) -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'The exact Cargo test artifact must not be a reparse point'
    }
    $beforeHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
    $baseline = Invoke-Captured $executable @('--list')
    Write-Host "[test-activation] executable=$([System.IO.Path]::GetFileName($executable)) before-sha256=$beforeHash list-before=$($baseline.ExitCode)"
    if ($baseline.ExitCode -eq 0) {
        if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Successful baseline executable changed' }
        Write-Host '[test-activation] unchanged; baseline harness starts'
        continue
    }
    if ($baseline.ExitCode -ne $entrypointNotFound) {
        throw "Unexpected pre-harness failure: $($baseline.ExitCode) $($baseline.Output) $($baseline.Error)"
    }

    $kit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin\*\x64\mt.exe'
    $mt = Get-ChildItem -Path $kit -File | Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
    if ($null -eq $mt) { throw 'Existing Windows SDK mt.exe was not found' }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $found = Invoke-Captured $vswhere @('-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-find', 'VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe')
    if ($found.ExitCode -ne 0 -or -not $found.Output.Trim()) { throw 'Existing Visual Studio dumpbin.exe was not found' }
    $dumpbin = ($found.Output.Trim() -split "`r?`n")[0]
    $imports = Invoke-Captured $dumpbin @('/imports', $executable)
    if ($imports.ExitCode -ne 0) { throw "Import inspection failed: $($imports.Error)" }
    foreach ($line in $imports.Output -split "`n") {
        if ($line -match 'comctl32|TaskDialogIndirect') { Write-Host "[test-activation] import $($line.Trim())" }
    }

    $prefix = "$executable.activation-$([guid]::NewGuid().ToString('N'))"
    $probe = "$prefix.exe"
    $beforePath = "$prefix.before.manifest"
    $dependencyPath = "$prefix.dependency.manifest"
    $afterPath = "$prefix.after.manifest"
    try {
        $before = Read-Manifest $mt.FullName $executable $beforePath
        $present = $null -ne $before
        Write-Host "[test-activation] manifest-before-present=$present controls-v6-before=$(Has-ControlsV6 $before)"
        if ($present) {
            Write-Host "[test-activation] manifest-before-sha256=$((Get-FileHash -LiteralPath $beforePath -Algorithm SHA256).Hash)"
            Write-Host $before.OuterXml
        }
        if (Has-ControlsV6 $before) { throw 'V6 is already declared; loader cause remains unidentified' }
        if ($present -and $before.SelectSingleNode("//*[local-name()='assemblyIdentity' and @name='Microsoft.Windows.Common-Controls']")) {
            throw 'An explicit different Common Controls dependency must not be replaced'
        }
        $dependency = @'
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" /></dependentAssembly></dependency>
</assembly>
'@
        [System.IO.File]::WriteAllText($dependencyPath, $dependency, [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::Copy($executable, $probe, $false)
        if ((Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash -ne $beforeHash) { throw 'The copied diagnostic executable differs from baseline' }
        Add-ControlsDependency $mt.FullName $probe $dependencyPath $present
        $probeManifest = Read-Manifest $mt.FullName $probe $afterPath
        if (-not (Has-ControlsV6 $probeManifest)) { throw 'The diagnostic manifest does not request Common Controls V6' }
        $control = Invoke-Captured $probe @('--list')
        Write-Host "[test-activation] copy-after-sha256=$((Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash) list-copy-after=$($control.ExitCode)"
        if ($control.ExitCode -ne 0 -or $control.Output -notmatch '(?m)^.+:\s+test\r?$') {
            throw "V6 did not prove harness startup with existing tests: $($control.Output) $($control.Error)"
        }
        Write-Host $control.Output
        if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Original executable changed during the copy experiment' }
        if ([System.IO.File]::GetAttributes($executable) -band [System.IO.FileAttributes]::ReparsePoint) {
            throw 'The original test artifact became a reparse point'
        }
        Add-ControlsDependency $mt.FullName $executable $dependencyPath $present
        $after = Read-Manifest $mt.FullName $executable $afterPath
        if (-not (Has-ControlsV6 $after)) { throw 'The test executable manifest does not request Common Controls V6' }
        $activated = Invoke-Captured $executable @('--list')
        Write-Host "[test-activation] after-sha256=$((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash) manifest-after-sha256=$((Get-FileHash -LiteralPath $afterPath -Algorithm SHA256).Hash) list-after=$($activated.ExitCode)"
        Write-Host $after.OuterXml
        if ($activated.ExitCode -ne 0 -or $activated.Output -notmatch '(?m)^.+:\s+test\r?$') { throw 'Activated original test harness did not start' }
        Write-Host '[test-activation] copy experiment confirmed the V6 activation dependency; ordinary cargo tests must now pass'
    }
    finally {
        foreach ($path in @($probe, $beforePath, $dependencyPath, $afterPath)) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
    }
}
