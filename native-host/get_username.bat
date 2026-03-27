@echo off
REM ============================================================
REM Native Messaging Host for ChatGPT Usage Tracker
REM Reads Windows %USERNAME% and returns as JSON to Chrome
REM 
REM IMPORTANT: Chrome Native Messaging protocol requires
REM the message length as a 4-byte little-endian prefix.
REM This .bat uses a helper VBScript for binary output.
REM ============================================================

REM Create temp VBScript for binary length prefix
set "TMPVBS=%TEMP%\gpt_tracker_nm.vbs"

REM Build the JSON response
set "JSON={\"username\":\"%USERNAME%\"}"

REM Calculate string length and write with binary prefix
echo Set objStream = CreateObject("ADODB.Stream") > "%TMPVBS%"
echo Dim strJSON : strJSON = "{\"username\":\"%USERNAME%\"}" >> "%TMPVBS%"
echo Dim nLen : nLen = LenB(strJSON) >> "%TMPVBS%"
echo objStream.Type = 1 >> "%TMPVBS%"
echo objStream.Open >> "%TMPVBS%"
echo Dim oRec : Set oRec = CreateObject("ADODB.Record") >> "%TMPVBS%"
echo WScript.StdOut.Write Chr(nLen And 255) ^& Chr((nLen\256) And 255) ^& Chr((nLen\65536) And 255) ^& Chr((nLen\16777216) And 255) ^& strJSON >> "%TMPVBS%"
cscript //nologo "%TMPVBS%"
del "%TMPVBS%" 2>nul
