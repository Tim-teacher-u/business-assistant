@echo off
cd /d "%~dp0"
node server/cli.mjs setup
node server/main.mjs
pause
