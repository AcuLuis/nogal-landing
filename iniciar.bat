@echo off
REM ===========================================================================
REM  NOGAL - Lanzador para Windows
REM  Doble clic: muestra un menu.  Tambien acepta:  iniciar.bat web | pruebas
REM ===========================================================================
setlocal
title NOGAL
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js.
  echo   Instala la version 22 o superior desde https://nodejs.org y vuelve a intentarlo.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% LSS 22 (
  echo.
  echo   Tienes Node.js v%NODE_MAJOR%. Se necesita la version 22 o superior.
  echo   Descargala desde https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "MODO=%~1"
if /i "%MODO%"=="web" goto web
if /i "%MODO%"=="pruebas" goto pruebas

:menu
cls
echo.
echo   NOGAL - Landing de manufactura de muebles
echo   -----------------------------------------
echo.
echo   [1] Abrir la landing en el navegador
echo   [2] Ejecutar las pruebas
echo   [3] Salir
echo.
choice /c 123 /n /m "  Elige una opcion: "
if errorlevel 3 exit /b 0
if errorlevel 2 goto pruebas
goto web

:web
echo.
echo   Iniciando el sitio... se abrira el navegador en unos segundos.
node scripts\serve.mjs 8080 --open
if errorlevel 1 pause
exit /b

:pruebas
echo.
call npm test
echo.
pause
if "%MODO%"=="" goto menu
exit /b
