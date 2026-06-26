Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\casey\OneDrive\Documents\Fiberlytic"
WshShell.Run "cmd /c npm run dev", 0, False
WScript.Sleep 5000
WshShell.Run "msedge http://localhost:5173"
