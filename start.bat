@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 20 goto old_node

rem pull 로 의존성이 바뀌었을 수 있으므로 매번 확인 (이미 설치되어 있으면 금방 끝남)
echo [1/3] 의존성 확인 중...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

if not exist .env copy .env.example .env >nul

echo [2/3] 웹 화면 빌드 중...
call npm run build
if errorlevel 1 goto fail

echo [3/3] 서버 시작...
call npm run start -w server
if errorlevel 1 goto fail
pause
exit /b 0

:no_node
echo Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전(20 이상)을 설치한 뒤 다시 실행하세요.
pause
exit /b 1

:old_node
echo Node.js 20 이상이 필요합니다. 현재 버전:
node -v
echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
pause
exit /b 1

:fail
echo.
echo 실행 중 오류가 발생했습니다. 위의 오류 메시지를 확인하세요.
pause
exit /b 1
