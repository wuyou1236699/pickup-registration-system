param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $projectRoot '.local-runtime'
$runtimeAlias = Join-Path $env:TEMP 'pickup-phase2-mysql'
$mysqlVersion = '8.4.11'
$mysqlArchive = Join-Path $runtimeRoot "mysql-$mysqlVersion-winx64.zip"
$mysqlBase = Join-Path $runtimeAlias "mysql-$mysqlVersion-winx64"
$mysqlData = Join-Path $runtimeAlias 'mysql-data'
$localConfig = Join-Path $projectRoot '.env.local'
if (Test-Path -LiteralPath $localConfig) {
  $configLines = Get-Content -LiteralPath $localConfig
  if ($configLines -notcontains 'MYSQL_HOST=127.0.0.1' -or $configLines -notcontains 'MYSQL_PORT=33307') { throw '已有连接配置不是项目本地33307实例，拒绝启动或停止，未覆盖配置' }
}
if ($Stop) {
  Push-Location $projectRoot
  try { node --env-file=.env.local scripts/stop-local-db.mjs; if ($LASTEXITCODE -ne 0) { throw '数据库停止失败' } }
  finally { Pop-Location }
  exit
}
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
if (Test-Path -LiteralPath $runtimeAlias) {
  $existingAlias = Get-Item -LiteralPath $runtimeAlias
  if ($existingAlias.LinkType -ne 'Junction' -or [System.IO.Path]::GetFullPath(@($existingAlias.Target)[0]) -ne $runtimeRoot) { throw '临时别名已被其他目录占用，未作修改' }
} else { New-Item -ItemType Junction -Path $runtimeAlias -Target $runtimeRoot | Out-Null }
if (-not (Test-Path -LiteralPath "$mysqlBase\bin\mysqld.exe")) {
  if (-not (Test-Path -LiteralPath $mysqlArchive)) {
    Write-Output '正在下载官方 MySQL 8.4.11 便携版本（约268 MB），不会安装系统服务。'
    Invoke-WebRequest -Uri "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-$mysqlVersion-winx64.zip" -OutFile $mysqlArchive
  }
  if ((Get-FileHash -LiteralPath $mysqlArchive -Algorithm MD5).Hash -ne '2e833921898a9a030ea6bfe81bd811bc') { throw '官方下载校验不一致' }
  Expand-Archive -LiteralPath $mysqlArchive -DestinationPath $runtimeRoot -Force
}
$localListener = Get-NetTCPConnection -LocalPort 33307 -State Listen -ErrorAction SilentlyContinue
if ($localListener) {
  $listenerProcess = Get-Process -Id $localListener.OwningProcess
  $allowedExecutables = @([System.IO.Path]::GetFullPath("$mysqlBase\bin\mysqld.exe"), [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "mysql-$mysqlVersion-winx64\bin\mysqld.exe")))
  if ([System.IO.Path]::GetFullPath($listenerProcess.Path) -notin $allowedExecutables) { throw '33307端口被其他程序占用，未作修改' }
  Write-Output '项目本地 MySQL 已在运行。'
  exit
}
if (-not (Test-Path -LiteralPath "$mysqlData\auto.cnf")) {
  & "$mysqlBase\bin\mysqld.exe" --no-defaults --initialize-insecure "--basedir=$mysqlBase" "--datadir=$mysqlData" --console
  if ($LASTEXITCODE -ne 0) { throw '初始化失败' }
}
$mysqlLog = Join-Path $runtimeAlias 'mysql-server.log'
$dbProcess = Start-Process -FilePath "$mysqlBase\bin\mysqld.exe" -ArgumentList @('--no-defaults',"--basedir=$mysqlBase","--datadir=$mysqlData",'--port=33307','--bind-address=127.0.0.1','--mysqlx=OFF',"--log-error=$mysqlLog",'--innodb-buffer-pool-size=64M') -WindowStyle Hidden -PassThru
$dbProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'mysql.pid')
Push-Location $projectRoot
try { node scripts/setup-local-db.mjs; if ($LASTEXITCODE -ne 0) { throw '本地配置未完成，请检查本地日志；未覆盖已有配置' } }
finally { Pop-Location }
Write-Output '本地 MySQL 已启动，仅监听127.0.0.1:33307；不使用腾讯云资源。'
