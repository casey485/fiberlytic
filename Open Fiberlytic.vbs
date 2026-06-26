Set WshShell = CreateObject("WScript.Shell")

' Stop any old server that might still be running from a previous session
WshShell.Run "cmd /c taskkill /f /im node.exe >nul 2>&1", 0, True
WScript.Sleep 2000

' Start the Vite dev server fresh in a hidden window
WshShell.CurrentDirectory = "C:\Users\casey\OneDrive\Documents\Fiberlytic"
WshShell.Run "cmd /c npm run dev", 0, False

' Wait for Vite to finish starting up
WScript.Sleep 12000

' Open Fiberlytic in the default browser
WshShell.Run "http://localhost:5173"
