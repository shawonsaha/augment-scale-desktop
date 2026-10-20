@echo off
rem Launch the XK3190 Scale Reader GUI (double-click this file).
cd /d "%~dp0"
py xk3190_scale_app.py %*
if errorlevel 1 pause
