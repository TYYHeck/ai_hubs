$ErrorActionPreference = 'Stop'
$base = 'http://8.138.24.27/api/v1'
$tmp = "$env:TEMP"
Set-Content -Path "$tmp\login.json" -Value '{"username":"admin","password":"admin123"}' -Encoding utf8
$tok = (curl.exe -s -X POST "$base/auth/login" -H 'Content-Type: application/json' -d "@$tmp\login.json" | ConvertFrom-Json).access_token
if ($tok.Length -eq 0) { Write-Output "LOGIN_FAILED"; exit 1 }

# 创建一个最小、确定配置的 Agent（无 RAG、指定模型）
Set-Content -Path "$tmp\a.json" -Value '{"name":"DiagAgent","model":"deepseek-chat","system_prompt":"你是助手","enable_rag":false,"memory_strength":1,"config_mode":"global"}' -Encoding utf8
$ag = (curl.exe -s -X POST "$base/agents" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "@$tmp\a.json" | ConvertFrom-Json)
$aid = $ag.id
Write-Output "AGENT_ID=$aid"

Set-Content -Path "$tmp\t.json" -Value ('{"title":"DIAG2","description":"hi","mode":"single","agent_ids":[' + $aid + ']}') -Encoding utf8
$task = (curl.exe -s -X POST "$base/tasks" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "@$tmp\t.json" | ConvertFrom-Json)
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
$d = (curl.exe -s "$base/tasks/$tid" -H "Authorization: Bearer $tok" | ConvertFrom-Json)
Write-Output "LAST=$(($d.events | Select-Object -Last 1 | ForEach-Object { $_.event + ':' + ($_.data | ConvertTo-Json -Compress) }))"
curl.exe -s -X DELETE "$base/agents/$aid" -H "Authorization: Bearer $tok" | Out-Null
curl.exe -s -X DELETE "$base/tasks/$tid" -H "Authorization: Bearer $tok" | Out-Null
Remove-Item -Force "$tmp\login.json","$tmp\a.json","$tmp\t.json" -ErrorAction SilentlyContinue
Write-Output "DONE"
