param([Parameter(Mandatory = $true)][string]$PostgresBin, [switch]$DeferDocumentScan, [string]$WorkspaceMigration)

$ErrorActionPreference = 'Stop'
$initdb = Join-Path $PostgresBin 'initdb.exe'
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$pgIsReady = Join-Path $PostgresBin 'pg_isready.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$sqlDir = Join-Path $PSScriptRoot '../supabase'
$labId = [guid]::NewGuid().ToString('N')
$cluster = Join-Path ([System.IO.Path]::GetTempPath()) "nvmed-lab-$labId"
$role = "nvmed_$labId"
$port = Get-Random -Minimum 49152 -Maximum 65535

Get-ChildItem Env: | Where-Object Name -Match '^PG' | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process')
}
$env:PGHOSTADDR = '127.0.0.1'
$env:PGCONNECT_TIMEOUT = '4'
$env:PGOPTIONS = '-c client_min_messages=warning'
$startAttempted = $false

function Invoke-LabSql {
  param([string[]]$Arguments)
  & $psql --no-psqlrc -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U $role -d postgres @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha na verificação SQL do laboratório descartável.' }
}

function Assert-LabSqlRejected {
  param([string[]]$Arguments, [string]$Expected)
  $result = & $psql --no-psqlrc -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U $role -d postgres @Arguments 2>&1
  if ($LASTEXITCODE -ne 3 -or ($result -join "`n") -notlike "*$Expected*") {
    throw "A verificação não recusou a condição esperada ($Expected). $result"
  }
}

try {
  & $initdb -D $cluster --username=$role --auth=trust --no-locale --encoding=UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar o cluster descartável.' }
  $serverLog = Join-Path $cluster 'server.log'
  $startupOptions = @{
    FilePath = $pgCtl
    WindowStyle = 'Hidden'
    PassThru = $true
    ArgumentList = @('-D', ('"{0}"' -f $cluster), '-l', ('"{0}"' -f $serverLog),
      '-o', ('"-h 127.0.0.1 -p {0}"' -f $port), '-t', '15', '-w', 'start')
    RedirectStandardOutput = Join-Path $cluster 'startup.out'
    RedirectStandardError = Join-Path $cluster 'startup.err'
  }
  $startAttempted = $true
  $startup = Start-Process @startupOptions
  [void]$startup.WaitForExit(20000)
  & $pgIsReady -q -h 127.0.0.1 -p $port -U $role -d postgres -t 4
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao iniciar o cluster descartável.'
  }
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'lab.fixture.sql'))
  Assert-LabSqlRejected -Arguments @('-f', (Join-Path $sqlDir 'init_all.sql')) -Expected 'instalador de demonstração foi desativado'
  foreach ($number in (1, 2, 4, 5, 6) + (8..25)) {
    if ($number -eq 19) {
      Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'production-inventory.read-only.sql'))
      Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'homologation.preflight.sql'))
    }
    if ($number -eq 24) {
      Invoke-LabSql -Arguments @('-c', 'GRANT SELECT (payment_amount), UPDATE (paid_amount) ON public.shifts TO anon, authenticated;')
    }
    $prefix = '{0:00}_*.sql' -f $number
    $file = @(Get-ChildItem -LiteralPath $sqlDir -Filter $prefix -File)
    if ($file.Count -ne 1) { throw "Migration ausente ou ambígua ($number)." }
    Invoke-LabSql -Arguments @('-f', $file[0].FullName)
    if ($number -in 1, 2, 4) {
      Invoke-LabSql -Arguments @('-v', "step=$number", '-f', (Join-Path $sqlDir 'provisioning.baseline.verify.sql'))
    }
  }
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'homologation.postflight.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'portal.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'pilot-auth.setup.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'pilot-auth.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '26_shift_payment_agreements.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-payment-agreements.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '27_effective_permissions.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '28_scoped_sectors_and_reports.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '29_sector_finance_and_open_agreements.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'sector-finance-and-open-agreements.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'effective-permissions-and-reports.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'portal.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-payment-agreements.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '30_shift_employment.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-employment.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '31_sector_primary_specialty.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'sector-primary-specialty.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-banking.fixture.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '32_doctor_banking.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-banking.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '33_staff_shift_read_performance.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-banking.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'staff-shift-read-performance.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '34_imported_document_originals.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'imported-document-originals.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '35_provisional_import_assignments.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'provisional-import-assignments.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '36_doctor_profile_access.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-profile-access.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'master-schedule.preflight.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '37_master_schedule.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'master-schedule.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '38_schedule_controls_and_audit.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'schedule-controls.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'master-schedule.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '39_schedule_audit_context.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'schedule-audit-context.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'schedule-controls.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'master-schedule.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '40_doctor_credential_writes.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-credential-writes.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-profile-access.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '41_administrative_mfa.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'administrative-mfa.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '42_attendance_confirmation.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'attendance-confirmation.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '43_doctor_data_minimization.sql'))
  $documentScanMigration = Join-Path $sqlDir '44_medical_document_quarantine.sql'
  if (!$DeferDocumentScan) { Invoke-LabSql -Arguments @('-f', $documentScanMigration) }
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '45_resumable_organization_cleanup.sql'))
  # Emulate legacy metadata and grants on the disposable database before the incremental repair.
  Invoke-LabSql -Arguments @('-c', @'
UPDATE storage.buckets SET public = true WHERE id = 'medical-documents';
GRANT SELECT (name) ON public.doctors TO PUBLIC;
CREATE POLICY "Public Read Medical Documents" ON storage.objects FOR SELECT TO anon USING (true);
'@)
  $provisioningVerify = Join-Path $sqlDir 'provisioning.verify.sql'
  Assert-LabSqlRejected -Arguments @('-f', $provisioningVerify) -Expected 'faltam etapas de endurecimento'
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '46_secure_provisioning.sql'))
  if ($DeferDocumentScan) {
    Assert-LabSqlRejected -Arguments @('-f', $provisioningVerify) -Expected 'faltam os controles de quarentena documental'
    Invoke-LabSql -Arguments @('-c', "SET nvmed.verify_deferred_document_scan = 'on';", '-f', $provisioningVerify)
    Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'medium-security.verify.sql'))
    Write-Output 'PASS: sequência 40–43, 45–46 com quarentena adiada.'
    Invoke-LabSql -Arguments @('-f', $documentScanMigration)
  }
  Invoke-LabSql -Arguments @('-f', $provisioningVerify)
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'medium-security.verify.sql'))
  Assert-LabSqlRejected -Arguments @('-c', 'BEGIN; GRANT SELECT (name) ON public.doctors TO PUBLIC;', '-f', $provisioningVerify) -Expected 'permissão anônima em public.doctors'
  Assert-LabSqlRejected -Arguments @('-c', "BEGIN; UPDATE storage.buckets SET public = true WHERE id = 'profile-avatars';", '-f', $provisioningVerify) -Expected 'buckets privados ou proteção do Storage ausentes'
  Assert-LabSqlRejected -Arguments @('-c', 'BEGIN; CREATE POLICY nv_lab_legacy ON storage.objects FOR SELECT TO PUBLIC USING (true);', '-f', $provisioningVerify) -Expected 'política permissiva legada ou anônima'
  Invoke-LabSql -Arguments @('-f', $provisioningVerify)
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '47_staff_account.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'staff-account.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'finance-evolution.preflight.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '48_shift_approval.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '49_shift_cash_payments.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-cash-payment.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '50_company_billing.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'company-billing.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '51_finance_overview_and_exports.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'finance-overview.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '52_shift_approval_activation_cutoff.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-approval.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'shift-approval-concurrency.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '53_fractional_coverage.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'fractional-coverage.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '54_doctor_name_normalization.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-names.preflight.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-names.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '53_doctor_status.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-status.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '55_interactive_shift_coverage.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'interactive-coverage.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '56_medical_document_webp.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '57_medical_storage_replacements.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '58_storage_usage.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'storage-usage.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-directory.preflight.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir '59_doctor_directory.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'doctor-directory.verify.sql'))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'workspace-loading.preflight.sql'))
  Invoke-LabSql -Arguments @('-f', $(if ($WorkspaceMigration) { $WorkspaceMigration } else { Join-Path $sqlDir '60_workspace_loading.sql' }))
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'workspace-loading.verify.sql'))
  $env:NVMED_STORAGE_PROJECT = 'local'
  $env:NVMED_STORAGE_PSQL = $psql
  $env:PGHOST = '127.0.0.1'
  $env:PGPORT = [string]$port
  $env:PGUSER = $role
  $env:PGDATABASE = 'postgres'
  & node (Join-Path $PSScriptRoot 'medical-storage.lab.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Falha no dry-run ou na recuperação em lote no laboratório.' }
  Write-Output 'PASS: baseline, segurança, migrations até 60 e suítes SQL.'
} finally {
  if ($startAttempted -and (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid'))) {
    & $pgCtl -D $cluster -m fast -w stop | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao parar o cluster descartável.' }
  }
}
