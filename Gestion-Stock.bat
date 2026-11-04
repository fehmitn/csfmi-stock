@echo off
rem ============================================
rem  Lanceur - Gestion de Stock Interne (Electron)
rem  Double-cliquez sur ce fichier pour demarrer
rem ============================================
title Gestion de Stock Interne
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo Premiere utilisation : installation des composants...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERREUR : installez Node.js depuis https://nodejs.org puis reessayez.
        pause
        exit /b 1
    )
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
