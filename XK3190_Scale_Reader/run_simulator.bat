@echo off
rem XK3190-D10 simulator - in-house testing without the scale (double-click).
rem   no args          -> runs the full self-test (proves everything works)
rem   with args        -> streams frames instead, e.g.:
rem     run_simulator.bat --list
rem     run_simulator.bat --scenario load --seconds 10
rem     run_simulator.bat --scenario badchecksum --seconds 5
rem Feed the GUI from it:   run_app.bat --sim --scenario load
rem Feed the console test:  run_console_test.bat --sim --scenario load --seconds 10
cd /d "%~dp0"
if "%~1"=="" (
    py xk3190_simulator.py --selftest
) else (
    py xk3190_simulator.py %*
)
echo.
pause
