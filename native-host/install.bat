@echo off
REM ============================================================
REM Installer for ChatGPT Usage Tracker Native Messaging Host
REM Auto-elevates to Administrator via UAC prompt
REM Can be deployed via Group Policy (GPO startup script)
REM ============================================================

REM ---- AUTO-ELEVATE TO ADMIN ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process -Verb RunAs -FilePath '%~f0' -ArgumentList '%~dp0'"
    exit /b
)

REM ---- Now running as Administrator ----
cd /d "%~dp0"

set "INSTALL_DIR=C:\ProgramData\GPTTracker"
set "HOST_NAME=com.astraglobal.gpt_tracker"
set "REG_KEY=HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

echo.
echo ============================================================
echo  ChatGPT Usage Tracker - Native Host Installer
echo ============================================================
echo.

echo [1/4] Creating install directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] Copying native host files...
copy /Y "%~dp0get_username.bat" "%INSTALL_DIR%\get_username.bat"
copy /Y "%~dp0%HOST_NAME%.json" "%INSTALL_DIR%\%HOST_NAME%.json"

echo [3/4] Registering native messaging host in registry...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%INSTALL_DIR%\%HOST_NAME%.json" /f

echo [4/4] Verifying installation...
echo.

set "FAIL=0"

if exist "%INSTALL_DIR%\get_username.bat" (
    echo   [OK] get_username.bat installed
) else (
    echo   [FAIL] get_username.bat missing!
    set "FAIL=1"
)

if exist "%INSTALL_DIR%\%HOST_NAME%.json" (
    echo   [OK] %HOST_NAME%.json installed
) else (
    echo   [FAIL] %HOST_NAME%.json missing!
    set "FAIL=1"
)

reg query "%REG_KEY%" /ve >nul 2>&1
if %errorlevel%==0 (
    echo   [OK] Registry key set
) else (
    echo   [FAIL] Registry key missing!
    set "FAIL=1"
)

echo.
if "%FAIL%"=="0" (
    echo ============================================================
    echo  Installation SUCCESSFUL
    echo ============================================================
) else (
    echo ============================================================
    echo  Installation had ERRORS - check output above
    echo ============================================================
)
echo.
pause
