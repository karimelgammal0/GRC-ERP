@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GRC ERP - Online
echo === تشغيل البرنامج + الرابط العام ===
rem قفل أي نسخة شغالة على المنفذ 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
if not exist cloudflared.exe (
  echo تحميل cloudflared لأول مرة...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)
start "GRC Server" cmd /k "node server/index.js"
timeout /t 8 >nul
echo.
echo هتلاقي الرابط العام تحت: سطر فيه https://....trycloudflare.com
echo شاركه مع الناس. لا تقفل النافذتين طول ما عايز البرنامج شغال.
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause
