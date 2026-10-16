@echo off
chcp 65001 >nul
title nalv.estudio - servidor local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta instalar Node.js. Bajalo de https://nodejs.org (version LTS), instalalo y volve a abrir este archivo.
  echo.
  pause
  exit /b
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  Se creo el archivo .env con los datos de ejemplo.
)

if not exist "node_modules" (
  echo  Instalando lo necesario ^(solo la primera vez, puede tardar unos minutos^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo  Fallo la instalacion. Revisa tu conexion a internet y probá de nuevo.
    pause
    exit /b
  )
)

rem Si quedo abierta una version vieja de la tienda (otra ventana negra), se cierra para que esta tome su lugar
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; Write-Host '  Cerre una version anterior de la tienda que seguia abierta.' } }" 2>nul

echo.
echo  Abriendo la tienda en http://localhost:3000   (panel: http://localhost:3000/admin.html)
echo  Usuario del panel: admin   Clave: cambiaesta123   (esta en el archivo .env)
echo  Para apagar el servidor cerra esta ventana.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
node server.js
pause
