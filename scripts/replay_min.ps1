#requires -Version 7.0
param(
  [string]$BaseUrl = "http://127.0.0.1:8787",
  [string]$Actor = "agent:replay_min_ps1@localhost",
  [string]$ReasonPrefix = "lmv/replay_min",
  [string]$WriteToken = ""
)

$ErrorActionPreference = "Stop"

function Get-Memory {
  Write-Host "== GET /v1/memory"
  $response = Invoke-WebRequest -Method GET -Uri "$BaseUrl/v1/memory"
  $etag = $response.Headers["ETag"]
  $body = $response.Content | ConvertFrom-Json
  return @{
    etag = $etag
    body = $body
  }
}

function Invoke-PatchMemory([string]$IfMatch, [array]$Patch, [string]$Reason) {
  Write-Host "== PATCH /v1/memory (If-Match=$IfMatch)"
  $headers = @{
    "If-Match" = $IfMatch
    "Content-Type" = "application/json-patch+json"
    "X-LMV-Actor" = $Actor
    "X-LMV-Reason" = $Reason
  }
  if ($WriteToken) {
    $headers["Authorization"] = "Bearer $WriteToken"
  }
  $jsonBody = $Patch | ConvertTo-Json -Depth 50

  try {
    $response = Invoke-WebRequest -Method PATCH -Uri "$BaseUrl/v1/memory" -Headers $headers -Body $jsonBody
    return @{
      ok = $true
      status = $response.StatusCode
      etag = $response.Headers["ETag"]
      body = ($response.Content | ConvertFrom-Json)
      raw = $response
    }
  } catch {
    $resp = $_.Exception.Response
    $status = 0
    $etag = $null
    $content = ""
    if ($resp) {
      $status = [int]$resp.StatusCode
      $etag = $resp.Headers["ETag"]
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $content = $reader.ReadToEnd()
      $reader.Dispose()
    }
    return @{
      ok = $false
      status = $status
      etag = $etag
      error = $content
    }
  }
}

function Get-Ledger([int]$Since = 0, [int]$Limit = 100) {
  Write-Host "== GET /v1/ledger?since=$Since&limit=$Limit"
  $body = Invoke-RestMethod -Method GET -Uri "$BaseUrl/v1/ledger?since=$Since&limit=$Limit"
  return $body
}

function Invoke-Snapshot {
  Write-Host "== POST /v1/snapshot"
  $headers = @{}
  if ($WriteToken) {
    $headers["Authorization"] = "Bearer $WriteToken"
  }
  return Invoke-RestMethod -Method POST -Uri "$BaseUrl/v1/snapshot" -Headers $headers
}

Write-Host "Replay started: $BaseUrl"

# 1) read memory
$m1 = Get-Memory
$etag1 = [string]$m1.etag
$version1 = [int]$m1.body.memory.version
$cursor1 = [int]$m1.body.ledger_cursor
Write-Host ("Current memory version={0} ledger_cursor={1} etag={2}" -f $version1, $cursor1, $etag1)

# 2) valid patch
$patch1 = @(
  @{
    op = "add"
    path = "/projects/lmv_demo"
    value = @{
      enabled = $true
      note = "seeded by replay_min.ps1"
      ts = (Get-Date).ToUniversalTime().ToString("o")
    }
  }
)

$r1 = Invoke-PatchMemory -IfMatch $etag1 -Patch $patch1 -Reason "$ReasonPrefix/patch1_add_demo"
if (-not $r1.ok) {
  throw "Patch1 failed. status=$($r1.status) etag=$($r1.etag) error=$($r1.error)"
}
Write-Host ("Patch1 ok. new_version={0} new_etag={1}" -f $r1.body.memory.version, $r1.etag)

# 3) stale etag conflict
$patch2 = @(
  @{
    op = "add"
    path = "/projects/lmv_demo_conflict"
    value = @{
      from = "stale-if-match"
      ts = (Get-Date).ToUniversalTime().ToString("o")
    }
  }
)

$r2 = Invoke-PatchMemory -IfMatch $etag1 -Patch $patch2 -Reason "$ReasonPrefix/patch2_expect_409"
if ($r2.ok) {
  Write-Host "Warning: expected 409 but patch2 succeeded."
} else {
  Write-Host ("Patch2 failed as expected. status={0} current_etag={1}" -f $r2.status, $r2.etag)
}

# 4) pull incremental ledger
$ledger = Get-Ledger -Since $cursor1 -Limit 100
Write-Host ("Ledger entries={0} next_cursor={1} has_more={2} snapshot_cursor={3} ledger_cursor={4}" -f `
  $ledger.entries.Count, $ledger.next_cursor, $ledger.has_more, $ledger.snapshot_cursor, $ledger.ledger_cursor)

# 5) replay patch2 with latest etag
$m2 = Get-Memory
$etag2 = [string]$m2.etag
$r3 = Invoke-PatchMemory -IfMatch $etag2 -Patch $patch2 -Reason "$ReasonPrefix/patch2_replay_after_pull"
if (-not $r3.ok) {
  throw "Patch2 replay failed. status=$($r3.status) etag=$($r3.etag) error=$($r3.error)"
}
Write-Host ("Patch2 replay ok. new_version={0} new_etag={1}" -f $r3.body.memory.version, $r3.etag)

# 6) snapshot
$snap = Invoke-Snapshot
Write-Host ("Snapshot done. snapshot_cursor={0} ledger_cursor={1} memory_version={2}" -f `
  $snap.snapshot_cursor, $snap.ledger_cursor, $snap.memory_version)

# 7) final check
$m3 = Get-Memory
Write-Host ("Final version={0} ledger_cursor={1} snapshot_cursor={2}" -f `
  $m3.body.memory.version, $m3.body.ledger_cursor, $m3.body.snapshot_cursor)
Write-Host "Replay done."
