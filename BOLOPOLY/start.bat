@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge-le sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b
)
if not exist node_modules call npm install
start "" http://localhost:8787
echo Le serveur BOLOPOLY tourne. Laisse cette fenetre ouverte pendant la partie.
call npm start
pause
