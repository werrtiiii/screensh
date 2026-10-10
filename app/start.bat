@echo off
cd /d "%~dp0"
echo Starting ScreenSh...
node_modules\electron\dist\electron.exe .
pause
