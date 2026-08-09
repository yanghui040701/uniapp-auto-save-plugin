$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedFullPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    return [System.IO.Path]::GetFullPath($LiteralPath).TrimEnd([char[]]'\/')
}

function Assert-SafeChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $fullCandidate = Get-NormalizedFullPath -LiteralPath $Candidate
    $rootPrefix = $Root + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullCandidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "PACKAGE_SAFETY_ERROR: $Label is outside the repository root: $fullCandidate"
    }

    $relative = $fullCandidate.Substring($rootPrefix.Length)
    $probe = $Root
    foreach ($segment in $relative.Split([char[]]'\/')) {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        $probe = Join-Path $probe $segment
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "PACKAGE_SAFETY_ERROR: $Label crosses a reparse point: $probe"
            }
        }
    }

    if (Test-Path -LiteralPath $fullCandidate) {
        $realCandidate = Get-NormalizedFullPath -LiteralPath (Resolve-Path -LiteralPath $fullCandidate).ProviderPath
        if (-not $realCandidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "PACKAGE_SAFETY_ERROR: $Label resolves outside the repository root: $realCandidate"
        }
        $fullCandidate = $realCandidate
    }

    return $fullCandidate
}

function Invoke-NpmStep {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )

    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "${FailureCode}: npm $($Arguments -join ' ') exited with code $LASTEXITCODE"
    }
}

try {
    $rootItem = Get-Item -LiteralPath (Join-Path $PSScriptRoot '..') -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "PACKAGE_SAFETY_ERROR: repository root cannot be a reparse point"
    }
    $root = Get-NormalizedFullPath -LiteralPath $rootItem.FullName
    if (-not [System.IO.Path]::IsPathRooted($root)) {
        throw "PACKAGE_SAFETY_ERROR: repository root is not absolute"
    }

    Push-Location -LiteralPath $root
    try {
        Invoke-NpmStep -Arguments @('test') -FailureCode 'PACKAGE_TEST_FAILED'
        Invoke-NpmStep -Arguments @('run', 'validate') -FailureCode 'PACKAGE_VALIDATION_FAILED'
    } finally {
        Pop-Location
    }

    $distDir = Assert-SafeChildPath -Root $root -Candidate (Join-Path $root 'dist') -Label 'dist'
    $stagingDir = Assert-SafeChildPath -Root $root -Candidate (Join-Path $distDir 'yanghui-auto-save') -Label 'staging'
    $zipPath = Assert-SafeChildPath -Root $root -Candidate (Join-Path $distDir 'yanghui-auto-save.zip') -Label 'zip'

    $validatorPath = Assert-SafeChildPath -Root $root -Candidate (Join-Path $root 'scripts\validate-package.js') -Label 'validator'
    if (-not (Test-Path -LiteralPath $validatorPath -PathType Leaf)) {
        throw 'PACKAGE_VALIDATION_FAILED: validator is not an ordinary file'
    }
    $allowlistOutput = & node.exe $validatorPath '--files-json'
    if ($LASTEXITCODE -ne 0) {
        throw "PACKAGE_VALIDATION_FAILED: validator allowlist query exited with code $LASTEXITCODE"
    }
    try {
        Add-Type -AssemblyName System.Web.Extensions
        $allowlistJson = [string]::Join([System.Environment]::NewLine, [string[]]@($allowlistOutput))
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $parsedAllowlist = $serializer.DeserializeObject($allowlistJson)
    } catch {
        throw "PACKAGE_VALIDATION_FAILED: validator returned invalid allowlist JSON"
    }

    # Preserve JSON structure until the top-level shape is proven. In particular,
    # never send DeserializeObject output through a PowerShell pipeline: Windows
    # PowerShell 5.1 recursively enumerates nested arrays there.
    if ($null -eq $parsedAllowlist -or $parsedAllowlist.GetType() -ne [System.Object[]] -or $parsedAllowlist.Rank -ne 1) {
        throw "PACKAGE_VALIDATION_FAILED: validator allowlist must be a one-dimensional JSON array"
    }
    $files = $parsedAllowlist
    if ($files.Count -ne 9) {
        throw "PACKAGE_VALIDATION_FAILED: validator returned $($files.Count) files instead of 9"
    }

    $expectedAllowlist = @(
        'package.json',
        'extension.js',
        'README.md',
        'CHANGELOG.md',
        'LICENSE',
        'lib/auto-save-controller.js',
        'lib/hbuilderx-runtime.js',
        'lib/focus-save-coordinator.js',
        'lib/prompt-state.js'
    )
    $copyPlan = @()
    $canonicalSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($canonicalFile in $expectedAllowlist) {
        [void]$canonicalSet.Add($canonicalFile)
    }
    $seenFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)

    for ($index = 0; $index -lt $files.Count; $index++) {
        $file = $files[$index]
        if (
            $file -isnot [string] -or
            [string]::IsNullOrWhiteSpace($file) -or
            $file -match '\s' -or
            [System.IO.Path]::IsPathRooted($file) -or
            $file.Contains('\') -or
            $file.Contains(':')
        ) {
            throw "PACKAGE_VALIDATION_FAILED: validator returned an unsafe allowlist entry"
        }
        $segments = @($file.Split('/'))
        if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -ne 0) {
            throw "PACKAGE_VALIDATION_FAILED: validator returned an unsafe allowlist entry"
        }
        if (-not $seenFiles.Add($file)) {
            throw "PACKAGE_VALIDATION_FAILED: validator returned a duplicate allowlist entry"
        }
        if (-not $canonicalSet.Contains($file)) {
            throw "PACKAGE_VALIDATION_FAILED: validator returned an unexpected allowlist entry"
        }
        $canonicalFile = $expectedAllowlist[$index]
        if (-not [System.StringComparer]::Ordinal.Equals($file, $canonicalFile)) {
            throw "PACKAGE_VALIDATION_FAILED: validator allowlist order or casing is not canonical"
        }

        $source = Assert-SafeChildPath -Root $root -Candidate (Join-Path $root $canonicalFile) -Label "source $canonicalFile"
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "PACKAGE_VALIDATION_FAILED: allowlisted source is not an ordinary file: $canonicalFile"
        }
        $sourceItem = Get-Item -LiteralPath $source -Force
        if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "PACKAGE_VALIDATION_FAILED: allowlisted source is not an ordinary file: $canonicalFile"
        }
        $destination = Assert-SafeChildPath -Root $root -Candidate (Join-Path $stagingDir $canonicalFile) -Label "destination $canonicalFile"
        $copyPlan += [PSCustomObject]@{
            File = $canonicalFile
            Source = $source
            Destination = $destination
        }
    }

    # Destructive cleanup begins only after every test, validation, path, allowlist,
    # and source-file preflight above has succeeded. The cached copy plan is the
    # only allowlist data consumed after this point.
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    if (-not (Test-Path -LiteralPath $distDir)) {
        New-Item -ItemType Directory -Path $distDir | Out-Null
    }
    New-Item -ItemType Directory -Path $stagingDir | Out-Null

    foreach ($entry in $copyPlan) {
        $destinationParent = Split-Path -Parent $entry.Destination
        if (-not (Test-Path -LiteralPath $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent | Out-Null
        }
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination
    }

    Compress-Archive -LiteralPath $stagingDir -DestinationPath $zipPath -CompressionLevel Optimal
    $zipPath = Assert-SafeChildPath -Root $root -Candidate $zipPath -Label 'zip'

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $normalizedEntries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        $actualFiles = @($normalizedEntries | Where-Object { -not $_.EndsWith('/') } | Sort-Object)
        $expectedFiles = @($expectedAllowlist | ForEach-Object { "yanghui-auto-save/$_" } | Sort-Object -CaseSensitive)
        $actualFiles = @($actualFiles | Sort-Object -CaseSensitive)
        $difference = @(Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles -CaseSensitive)
        if ($actualFiles.Count -ne 9 -or $difference.Count -ne 0) {
            throw 'PACKAGE_ARCHIVE_INVALID: ZIP file entries do not match the validator allowlist'
        }

        $roots = @($normalizedEntries | Where-Object { $_ } | ForEach-Object { ($_ -split '/', 2)[0] } | Sort-Object -Unique)
        if ($roots.Count -ne 1 -or $roots[0] -ne 'yanghui-auto-save') {
            throw 'PACKAGE_ARCHIVE_INVALID: ZIP must contain one yanghui-auto-save root directory'
        }

        $allowedDirectories = @('yanghui-auto-save/', 'yanghui-auto-save/lib/')
        $unexpectedDirectories = @($normalizedEntries | Where-Object {
            $_.EndsWith('/') -and $_ -notin $allowedDirectories
        })
        if ($unexpectedDirectories.Count -ne 0) {
            throw 'PACKAGE_ARCHIVE_INVALID: ZIP contains an unexpected directory entry'
        }
    } finally {
        $archive.Dispose()
    }

    Write-Output "Created $zipPath with 9 validated files."
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
