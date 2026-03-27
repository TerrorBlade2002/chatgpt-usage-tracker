@echo off
REM ============================================================
REM Installer for ChatGPT Usage Tracker Native Messaging Host
REM Run this as Administrator on each agent's machine
REM Can be deployed via Group Policy (GPO startup script)
REM ============================================================

set "INSTALL_DIR=C:\ProgramData\GPTTracker"
set "HOST_NAME=com.astraglobal.gpt_tracker"
set "REG_KEY=HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

echo [1/4] Creating install directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] Copying native host files...
copy /Y "%~dp0get_username.bat" "%INSTALL_DIR%\get_username.bat"
copy /Y "%~dp0%HOST_NAME%.json" "%INSTALL_DIR%\%HOST_NAME%.json"

echo [3/4] Registering native messaging host in registry...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%INSTALL_DIR%\%HOST_NAME%.json" /f

echo [4/4] Verifying installation...
if exist "%INSTALL_DIR%\get_username.bat" (
    echo [OK] get_username.bat installed
) else (
    echo [FAIL] get_username.bat missing!
)
reg query "%REG_KEY%" /ve >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Registry key set
) else (
    echo [FAIL] Registry key missing!
)

echo.
echo Installation complete.
echo NOTE: Update the extension ID in %HOST_NAME%.json after loading the extension.
pause
