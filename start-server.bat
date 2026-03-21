@echo off
echo Starting local dev server for Pixel Office Game...
echo.
echo Open your browser to:
echo   Default layout:   http://localhost:8080/pixel-office-game/
echo   Open-plan:        http://localhost:8080/pixel-office-game/?layout=openplan
echo   Promo:            http://localhost:8080/pixel-office-game/?layout=promo
echo.
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0\.."
npx --yes serve . --listen 8080 --no-clipboard
