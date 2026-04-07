@echo off
REM ============================================================
REM ChatGPT Usage Tracker - Native Messaging Host Installer
REM SELF-CONTAINED: No additional files required - deploy this
REM single .bat via GPO User Logon Script or login script.
REM NO ADMIN REQUIRED - installs per-user under HKCU + LOCALAPPDATA
REM ============================================================
REM Idempotent: safe to run on every logon (overwrites gracefully)
REM ============================================================

set "INSTALL_DIR=%LOCALAPPDATA%\GPTTracker"
set "HOST_NAME=com.astraglobal.gpt_tracker"
set "REG_KEY=HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

echo ============================================================
echo  ChatGPT Usage Tracker - Native Host Installer
echo  Installing for user: %USERNAME%
echo ============================================================
echo.

REM ---- Step 1: Create install directory ----
echo [1/4] Creating install directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM ---- Step 2: Write get_username.bat inline (no external file needed) ----
echo [2/4] Writing get_username.bat...
> "%INSTALL_DIR%\get_username.bat" echo @echo off
>> "%INSTALL_DIR%\get_username.bat" echo REM Native messaging host for ChatGPT Usage Tracker
>> "%INSTALL_DIR%\get_username.bat" echo REM Returns Windows username via Chrome native messaging protocol
>> "%INSTALL_DIR%\get_username.bat" echo powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$u=$env:USERNAME;$j='{\"username\":\"'+$u+'\"}';$b=[Text.Encoding]::UTF8.GetBytes($j);$l=[BitConverter]::GetBytes([int32]$b.Length);$o=[Console]::OpenStandardOutput();$o.Write($l,0,4);$o.Write($b,0,$b.Length);$o.Flush();$o.Close()"

REM ---- Step 3: Generate native host manifest JSON ----
echo [3/4] Generating native host manifest...
REM Using a temp VBS to handle JSON path escaping reliably
set "VBS=%TEMP%\gpt_mkjson_%RANDOM%.vbs"
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
>> "%VBS%" echo f.WriteLine "    ""chrome-extension://fccndghbhjcjiikkjbppancdhdmgbkme/"""
>> "%VBS%" echo f.WriteLine "  ]"
>> "%VBS%" echo f.WriteLine "}"
>> "%VBS%" echo f.Close
cscript //nologo "%VBS%"
del "%VBS%" 2>nul

REM ---- Step 4: Register in HKCU (no admin) ----
echo [4/4] Registering native messaging host in registry (HKCU)...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%INSTALL_DIR%\%HOST_NAME%.json" /f >nul 2>&1

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
REM When deployed via GPO, remove or comment out the pause below.
REM pause
