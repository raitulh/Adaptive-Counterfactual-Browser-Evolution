@echo off
title ACBE - Adaptive Counterfactual Browser Evolution
echo =====================================================================
echo  [ACBE] Starting Next.js Frontend + Python Autonomous Backend
echo =====================================================================
echo.

cd /d "%~dp0"

:: 1. Check Python
where py >nul 2>nul
if %errorlevel% equ 0 (
    set PY_CMD=py
) else (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        set PY_CMD=python
    ) else (
        echo [ERROR] Python not found. Please install Python 3.10+ to continue.
        pause
        exit /b 1
    )
)

:: 2. Check Node & npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js and npm not found. Please install Node.js 18+ to continue.
    pause
    exit /b 1
)

:: 3. Launch Python Backend Server on Port 8420
echo [1/3] Launching ACBE Python API Engine on http://127.0.0.1:8420 ...
start "ACBE Backend Server" cmd /k "%PY_CMD% -m acbe.cli.main serve --host 127.0.0.1 --port 8420 --db .acbe/acbe.db"

:: Wait 2 seconds for backend initialization
timeout /t 2 /nobreak >nul

:: 4. Launch Next.js Frontend Server on Port 3000
echo [2/3] Starting Next.js App Router Frontend on http://localhost:3000 ...
cd frontend
if not exist node_modules (
    echo Installing frontend dependencies (first-time setup)...
    call npm install
)

start "ACBE Frontend (Next.js)" cmd /k "npm run dev"

:: 5. Open Default Browser
echo [3/3] Opening ACBE Interactive Console in your browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo =====================================================================
echo  [SUCCESS] Both ACBE Backend (8420) and Frontend (3000) are running!
echo  - Landing Page:  http://localhost:3000/
echo  - Engineering:   http://localhost:3000/console
echo =====================================================================
echo Keep this window open or close it when done.
pause
