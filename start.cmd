@echo off
rem 双击启动即案 FLASHPLAN：切到本脚本所在目录，已在运行就直接打开浏览器
cd /d "%~dp0"
netstat -ano | findstr ":5188" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo 工作台已在运行，直接打开浏览器
) else (
  start "FLASHPLAN server" node server.mjs
  timeout /t 2 >nul
)
start "" http://127.0.0.1:5188/
