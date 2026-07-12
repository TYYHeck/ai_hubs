$ErrorActionPreference = 'Stop'
$base = 'http://8.138.24.27/api/v1'
$tmp = "$env:TEMP"
Set-Content -Path "$tmp\login.json" -Value '{"username":"admin","password":"admin123"}' -Encoding utf8
$tok = (curl.exe -s -X POST "$base/auth/login" -H 'Content-Type: application/json' -d "@$tmp\login.json" | ConvertFrom-Json).access_token
if ($tok.Length -eq 0) { Write-Output "LOGIN_FAILED"; exit 1 }

Set-Content -Path "$tmp\task.json" -Value '{"title":"DIAG","description":"hi","mode":"single"}' -Encoding utf8
$task = (curl.exe -s -X POST "$base/tasks" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "@$tmp\task.json" | ConvertFrom-Json)
$tid = $task.id
Write-Output "TASK_ID=$tid"
curl.exe -s -X POST "$base/tasks/$tid/execute" -H "Authorization: Bearer $tok" | Out-Null

for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 5
  $d = (curl.exe -s "$base/tasks/$tid" -H "Authorization: Bearer $tok" | ConvertFrom-Json)
  $evs = ($d.events | ForEach-Object { $_.event }) -join ','
  Write-Output "T+$($i*5)s STATUS=$($d.status) EVENTS=[$evs]"
  if ($d.status -eq 'completed' -or $d.status -eq 'failed') { break }
}
# 打印最后一条事件详情
$d = (curl.exe -s "$base/tasks/$tid" -H "Authorization: Bearer $tok" | ConvertFrom-Json)
Write-Output "LAST_EVENT_DATA=$(($d.events | Select-Object -Last 1 | ForEach-Object { $_.event + ':' + ($_.data | ConvertTo-Json -Compress) }))"
curl.exe -s -X DELETE "$base/tasks/$tid" -H "Authorization: Bearer $tok" | Out-Null
Remove-Item -Force "$tmp\login.json","$tmp\task.json" -ErrorAction SilentlyContinue
Write-Output "DONE"
