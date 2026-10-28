@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-With-Simulator.ps1" %*
if errorlevel 1 pause
