@echo off
:: OpenClaw Watchdog Launcher
:: Starts the PowerShell watchdog that monitors all services.
title OpenClaw Watchdog
powershell -ExecutionPolicy Bypass -File "C:\Users\zionv\OneDrive\Desktop\multbot\watchdog.ps1"
