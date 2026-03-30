@echo off
REM ============================================================
REM Native Messaging Host for ChatGPT Usage Tracker
REM Reads Windows %USERNAME% and returns as JSON to Chrome
REM Uses PowerShell for reliable binary length prefix output
REM ============================================================

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$json = '{"username":"' + $env:USERNAME + '"}'; " ^
  "$bytes = [System.Text.Encoding]::UTF8.GetBytes($json); " ^
  "$len = [BitConverter]::GetBytes([int]$bytes.Length); " ^
  "$stdout = [Console]::OpenStandardOutput(); " ^
  "$stdout.Write($len, 0, 4); " ^
  "$stdout.Write($bytes, 0, $bytes.Length); " ^
  "$stdout.Flush()"
