<#
.SYNOPSIS
Checks the Authenticode signature on release binaries.

.DESCRIPTION
Uses Get-AuthenticodeSignature rather than `signtool verify`: signtool ships
with the Windows SDK and is not present on a stock Windows 11 machine, so anyone
who downloaded a release can run this without installing anything.

Kept in step with the reference copy in spilloid/spoolsmith
(scripts/verify-signature.ps1); only this header differs.

Requires a countersigned timestamp, not just a valid signature. Azure Artifact
Signing certificates are valid for three days; an untimestamped signature stops
verifying almost immediately, and that failure would otherwise only show up on
a user's machine days after the release.

Exits non-zero if any file fails, so CI can gate a release on it.

.EXAMPLE
./scripts/verify-signature.ps1 -Files netviz/netviz.exe, netviz/bin/netviz-cli.exe

.EXAMPLE
Get-ChildItem netviz -Recurse -Filter *.exe | ForEach-Object { $_.FullName } |
    ForEach-Object { ./scripts/verify-signature.ps1 -Files $_ }
#>
param(
    [Parameter(Mandatory)][string[]]$Files,
    # Substring the signer's subject must contain, e.g. 'O=Spilloid'. Catches a
    # correctly-signed binary that was signed by the wrong certificate profile.
    [string]$ExpectedSubject
)
$ErrorActionPreference = 'Stop'
$failed = @()

foreach ($file in $Files) {
    $path = (Resolve-Path $file).Path
    $sig = Get-AuthenticodeSignature -FilePath $path

    if ($sig.Status -ne 'Valid') {
        $failed += "$path — signature status $($sig.Status): $($sig.StatusMessage)"
        continue
    }
    if (-not $sig.TimeStamperCertificate) {
        $failed += "$path — signed but not timestamped; the signature expires with the 3-day signing certificate"
        continue
    }
    if ($ExpectedSubject -and $sig.SignerCertificate.Subject -notlike "*$ExpectedSubject*") {
        $failed += "$path — signed by '$($sig.SignerCertificate.Subject)', expected it to contain '$ExpectedSubject'"
        continue
    }

    Write-Host "OK  $([IO.Path]::GetFileName($path))"
    Write-Host "    signer:    $($sig.SignerCertificate.Subject)"
    Write-Host "    expires:   $($sig.SignerCertificate.NotAfter.ToString('u'))"
    Write-Host "    timestamp: $($sig.TimeStamperCertificate.Subject)"
}

if ($failed) {
    $failed | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    throw "Signature verification failed for $($failed.Count) file(s)"
}
Write-Host "All $($Files.Count) file(s) carry a valid, timestamped Authenticode signature."
