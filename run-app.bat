@echo off
cd /d "%~dp0"
if exist "%~dp0scripts\run-app.ps1" goto run
echo.
echo  [!] scripts folder not found.
echo      Please EXTRACT the whole zip first - right-click the zip, Extract All -
echo      then double-click run-app.bat inside the extracted folder.
echo.
pause
exit /b 1
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-app.ps1"
echo.
pause
