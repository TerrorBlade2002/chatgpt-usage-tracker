@echo off
REM Native messaging host for ChatGPT Usage Tracker
REM Reads Windows username and returns it via Chrome native messaging protocol
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$u=$env:USERNAME;$j='{\"username\":\"'+$u+'\"}';$b=[Text.Encoding]::UTF8.GetBytes($j);$l=[BitConverter]::GetBytes([int32]$b.Length);$o=[Console]::OpenStandardOutput();$o.Write($l,0,4);$o.Write($b,0,$b.Length);$o.Flush();$o.Close()"
