@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 이상이 필요합니다: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo 의존성을 설치하는 중입니다...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if not exist .env copy .env.example .env >nul
call npm run start
pause
