$ErrorActionPreference = 'Stop'
$base = 'http://8.138.24.27/api/v1'
$tmp = "$env:TEMP"

# 1) 登录
Set-Content -Path "$tmp\login.json" -Value '{"username":"admin","password":"admin123"}' -Encoding utf8
$tok = (curl.exe -s -X POST "$base/auth/login" -H 'Content-Type: application/json' -d "@$tmp\login.json" | ConvertFrom-Json).access_token
if ($tok.Length -eq 0) { Write-Output "LOGIN_FAILED"; exit 1 }
Write-Output "TOKEN_LEN=$($tok.Length)"

# 2) 确保有一个 Agent（没有就建一个）
$agents = (curl.exe -s "$base/agents" -H "Authorization: Bearer $tok" | ConvertFrom-Json)
if ($agents.Count -eq 0) {
  Set-Content -Path "$tmp\agent.json" -Value '{"name":"测试Agent","model":"deepseek-chat","system_prompt":"你是助手"}' -Encoding utf8
  $agents = @(curl.exe -s -X POST "$base/agents" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "@$tmp\agent.json" | ConvertFrom-Json)
  Write-Output "CREATED_AGENT=$($agents[0].id)"
} else {
  Write-Output "EXISTING_AGENT=$($agents[0].id)"
}

# 3) 创建 single 模式任务
Set-Content -Path "$tmp\task.json" -Value '{"title":"SSE验证任务","description":"用一句话介绍AI Hubs","mode":"single"}' -Encoding utf8
$task = (curl.exe -s -X POST "$base/tasks" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "@$tmp\task.json" | ConvertFrom-Json)
$tid = $task.id
Write-Output "TASK_ID=$tid STATUS=$($task.status)"

# 4) 后台开启 SSE 流（实时事件）
$sseFile = "$tmp\sse.txt"
Remove-Item -Force $sseFile -ErrorAction SilentlyContinue
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'curl.exe'
$psi.Arguments = "-s -N $base/tasks/$tid/stream -H `"Authorization: Bearer $tok`""
$psi.RedirectStandardOutput = $true
$psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)

# 5) 等 1s 让 SSE 连接建立，再触发执行
Start-Sleep -Seconds 1
Write-Output "EXECUTING..."
curl.exe -s -X POST "$base/tasks/$tid/execute" -H "Authorization: Bearer $tok" | Out-Null

# 6) 等待任务跑完（最多 25s）
Start-Sleep -Seconds 45
if (-not $p.HasExited) { $p.Kill() }
$p.WaitForExit(2000)

# 7) 输出 SSE 收到的事件
$raw = $p.StandardOutput.ReadToEnd()
$events = ($raw -split "`n" | Where-Object { $_ -like 'data: *' } | ForEach-Object { ($_ -replace '^data: ','') })
Write-Output "=== SSE EVENTS RECEIVED (count=$($events.Count)) ==="
$events | ForEach-Object { Write-Output $_ }

# 8) 最终任务状态
$final = (curl.exe -s "$base/tasks/$tid" -H "Authorization: Bearer $tok" | ConvertFrom-Json)
Write-Output "FINAL_STATUS=$($final.status)"

# 清理
curl.exe -s -X DELETE "$base/tasks/$tid" -H "Authorization: Bearer $tok" | Out-Null
Remove-Item -Force "$tmp\login.json","$tmp\agent.json","$tmp\task.json","$tmp\sse.txt" -ErrorAction SilentlyContinue
Write-Output "CLEANED"
