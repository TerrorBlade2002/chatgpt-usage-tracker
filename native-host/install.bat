@echo off
REM ============================================================
REM Installer for ChatGPT Usage Tracker Native Messaging Host
REM NO ADMIN REQUIRED - installs per-user under HKCU + LOCALAPPDATA
REM For 400+ agent deployment via login script or GPO user script
REM ============================================================

set "INSTALL_DIR=%LOCALAPPDATA%\GPTTracker"
set "HOST_NAME=com.astraglobal.gpt_tracker"
set "REG_KEY=HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

echo ============================================================
echo  ChatGPT Usage Tracker - Native Host Installer
echo  Installing for user: %USERNAME%
echo ============================================================
echo.

echo [1/4] Creating install directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] Copying native host files...
copy /Y "%~dp0get_username.bat" "%INSTALL_DIR%\get_username.bat"

echo [3/4] Generating native host manifest with correct path...
REM Dynamically generate the JSON with properly escaped backslashes
REM Using a temp VBS to handle the JSON path escaping reliably
set "VBS=%TEMP%\gpt_mkjson.vbs"
> "%VBS%" echo Set fso = CreateObject("Scripting.FileSystemObject")
>> "%VBS%" echo installDir = "%INSTALL_DIR%"
>> "%VBS%" echo hostName = "%HOST_NAME%"
>> "%VBS%" echo jsonPath = installDir ^& "\" ^& hostName ^& ".json"
>> "%VBS%" echo batPath = Replace(installDir ^& "\get_username.bat", "\", "\\")
>> "%VBS%" echo Set f = fso.CreateTextFile(jsonPath, True)
>> "%VBS%" echo f.WriteLine "{"
>> "%VBS%" echo f.WriteLine "  ""name"": """ ^& hostName ^& ""","
>> "%VBS%" echo f.WriteLine "  ""description"": ""Native messaging host for ChatGPT Usage Tracker"","
>> "%VBS%" echo f.WriteLine "  ""path"": """ ^& batPath ^& ""","
>> "%VBS%" echo f.WriteLine "  ""type"": ""stdio"","
>> "%VBS%" echo f.WriteLine "  ""allowed_origins"": ["
>> "%VBS%" echo f.WriteLine "    ""chrome-extension://ndfelepbkmkcjbcgloakipoghcnakcga/"""
>> "%VBS%" echo f.WriteLine "  ]"
>> "%VBS%" echo f.WriteLine "}"
>> "%VBS%" echo f.Close
cscript //nologo "%VBS%"
del "%VBS%" 2>nul

echo [4/4] Registering native messaging host in registry (HKCU - no admin needed)...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%INSTALL_DIR%\%HOST_NAME%.json" /f

echo.
echo Verifying installation...
set "FAIL=0"

if exist "%INSTALL_DIR%\get_username.bat" (
    echo  [OK] get_username.bat installed
) else (
    echo  [FAIL] get_username.bat missing!
    set "FAIL=1"
)

if exist "%INSTALL_DIR%\%HOST_NAME%.json" (
    echo  [OK] %HOST_NAME%.json generated
) else (
    echo  [FAIL] %HOST_NAME%.json missing!
    set "FAIL=1"
)

reg query "%REG_KEY%" /ve >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Registry key set under HKCU
) else (
    echo  [FAIL] Registry key missing!
    set "FAIL=1"
)

echo.
if "%FAIL%"=="0" (
    echo ============================================================
    echo  Installation SUCCESSFUL for user: %USERNAME%
    echo  Install dir: %INSTALL_DIR%
    echo  Registry:    %REG_KEY%
    echo ============================================================
) else (
    echo ============================================================
    echo  Installation had ERRORS - check output above
    echo ============================================================
)
echo.
echo NOTE: If the Chrome extension ID changes, update the
echo       allowed_origins in this script and re-run it.
pause
