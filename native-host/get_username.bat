@echo off
set "PS1=%TEMP%\gpt_tracker_nm.ps1"
> "%PS1%" echo $u = $env:USERNAME
>> "%PS1%" echo $json = '{"username":"' + $u + '"}'
>> "%PS1%" echo $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
>> "%PS1%" echo $len = [System.BitConverter]::GetBytes([int32]$bytes.Length)
>> "%PS1%" echo $out = [Console]::OpenStandardOutput()
>> "%PS1%" echo $out.Write($len, 0, 4)
>> "%PS1%" echo $out.Write($bytes, 0, $bytes.Length)
>> "%PS1%" echo $out.Flush()
>> "%PS1%" echo $out.Close()
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%PS1%"
del "%PS1%" 2>nul
