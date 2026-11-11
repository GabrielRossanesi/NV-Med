param([Parameter(Mandatory = $true)][string]$PostgresBin)

$ErrorActionPreference = 'Stop'
$initdb = Join-Path $PostgresBin 'initdb.exe'
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
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
  if (!$startup.WaitForExit(20000) -or $startup.ExitCode -ne 0) {
    throw 'Falha ao iniciar o cluster descartável.'
  }
  Invoke-LabSql -Arguments @('-f', (Join-Path $sqlDir 'lab.fixture.sql'))
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
  Write-Output 'PASS: baseline 01-18, migrations 19-30, pré/pós-verificação e suítes SQL.'
} finally {
  if ($startAttempted -and (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid'))) {
    & $pgCtl -D $cluster -m fast -w stop | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao parar o cluster descartável.' }
  }
}
