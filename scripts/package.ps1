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

    if (-not (Test-Path -LiteralPath $distDir)) {
        New-Item -ItemType Directory -Path $distDir | Out-Null
    }
    $distDir = Assert-SafeChildPath -Root $root -Candidate $distDir -Label 'dist'
    $stagingDir = Assert-SafeChildPath -Root $root -Candidate $stagingDir -Label 'staging'
    $zipPath = Assert-SafeChildPath -Root $root -Candidate $zipPath -Label 'zip'

    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    New-Item -ItemType Directory -Path $stagingDir | Out-Null

    $validatorPath = Assert-SafeChildPath -Root $root -Candidate (Join-Path $root 'scripts\validate-package.js') -Label 'validator'
    $allowlistJson = & node.exe $validatorPath '--files-json'
    if ($LASTEXITCODE -ne 0) {
        throw "PACKAGE_VALIDATION_FAILED: validator allowlist query exited with code $LASTEXITCODE"
    }
    try {
        $parsedAllowlist = $allowlistJson | ConvertFrom-Json
        $files = @($parsedAllowlist | ForEach-Object { $_ })
    } catch {
        throw "PACKAGE_VALIDATION_FAILED: validator returned invalid allowlist JSON"
    }
    if ($files.Count -ne 9) {
        throw "PACKAGE_VALIDATION_FAILED: validator returned $($files.Count) files instead of 9"
    }

    foreach ($file in $files) {
        if ($file -isnot [string] -or [string]::IsNullOrWhiteSpace($file) -or [System.IO.Path]::IsPathRooted($file)) {
            throw "PACKAGE_VALIDATION_FAILED: validator returned an unsafe allowlist entry"
        }
        $source = Assert-SafeChildPath -Root $root -Candidate (Join-Path $root $file) -Label "source $file"
        $destination = Assert-SafeChildPath -Root $root -Candidate (Join-Path $stagingDir $file) -Label "destination $file"
        $destinationParent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent | Out-Null
        }
        Copy-Item -LiteralPath $source -Destination $destination
    }

    Compress-Archive -LiteralPath $stagingDir -DestinationPath $zipPath -CompressionLevel Optimal
    $zipPath = Assert-SafeChildPath -Root $root -Candidate $zipPath -Label 'zip'

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $normalizedEntries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        $actualFiles = @($normalizedEntries | Where-Object { -not $_.EndsWith('/') } | Sort-Object)
        $expectedFiles = @($files | ForEach-Object { "yanghui-auto-save/$($_.Replace('\', '/'))" } | Sort-Object)
        $difference = @(Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles)
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
