@echo off
cd /d %~dp0
echo Starting the local server for the simulator dashboard...
echo.
echo Once you see "Development Server (http://localhost:8080) started",
echo open this address in your browser:
echo.
echo     http://localhost:8080/index.html
echo.
echo Leave this window open while you're monitoring a test run.
echo Press Ctrl+C here to stop the server.
echo.
php -S localhost:8080
pause
