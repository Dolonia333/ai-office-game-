@echo off
echo Starting Denizen dev server...
echo.
echo Open your browser to:
echo   Default layout:   http://localhost:8080/
echo   Open-plan:        http://localhost:8080/?layout=openplan
echo   Promo:            http://localhost:8080/?layout=promo
echo   60s voice tour:   http://localhost:8080/?demo=tour
echo.
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
npm start
