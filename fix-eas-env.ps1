# Recreate all EXPO_PUBLIC_* EAS env vars as plaintext visibility,
# scoped to the production environment. Reads values from local .env.
#
# Why: Secret-visibility env vars are NOT injected into the JS bundle
# during EAS Build (by design — secrets shouldn't end up in client code).
# EXPO_PUBLIC_* vars by name are public, so they must be plaintext to
# get embedded. The eas-cli doesn't allow in-place visibility changes,
# so we delete and recreate.
#
# Usage:
#   .\fix-eas-env.ps1
#
# Requires: eas-cli logged in, .env file present at project root.

$ErrorActionPreference = 'Continue'

$vars = @(
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_FIREBASE_RECAPTCHA_SITE_KEY',
  'EXPO_PUBLIC_SENTRY_DSN'
)

if (-not (Test-Path .env)) {
  Write-Host 'ERROR: .env file not found in current directory' -ForegroundColor Red
  exit 1
}

$envContent = Get-Content .env

foreach ($var in $vars) {
  Write-Host ''
  Write-Host "Processing $var" -ForegroundColor Cyan

  $line = $envContent | Where-Object { $_ -match "^$var=" } | Select-Object -First 1
  if (-not $line) {
    Write-Host "  WARNING: $var not found in .env. Skipping." -ForegroundColor Yellow
    continue
  }

  $value = $line -replace "^$var=", '' -replace '^"', '' -replace '"$', '' -replace "^'", '' -replace "'$", ''

  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "  WARNING: $var has empty value in .env. Skipping." -ForegroundColor Yellow
    continue
  }

  Write-Host '  Deleting existing entry (if any)...' -ForegroundColor Gray
  eas env:delete --variable-name $var --variable-environment production --non-interactive 2>&1 | Out-Null

  Write-Host '  Creating as plaintext...' -ForegroundColor Gray
  eas env:create --environment production --name $var --value $value --visibility plaintext --non-interactive
}

Write-Host ''
Write-Host '====================================' -ForegroundColor Green
Write-Host 'Done. Verifying with eas env:list...' -ForegroundColor Green
Write-Host '====================================' -ForegroundColor Green
Write-Host ''
eas env:list --environment production
