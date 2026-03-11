@echo off
start "Claude" powershell -NoExit -Command "cd C:\Projects\PDA\; claude --dangerously-skip-permissions"
start "Dev Server" powershell -NoExit -Command "cd C:\Projects\PDA\; npm run dev"
