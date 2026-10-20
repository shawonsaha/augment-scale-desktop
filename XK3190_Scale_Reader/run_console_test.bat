@echo off
rem Quick console test of the scale's serial stream (double-click this file).
rem Add options after the script name, e.g.:  run_console_test.bat --seconds 10 --raw
cd /d "%~dp0"
py xk3190_console_test.py %*
echo.
pause
