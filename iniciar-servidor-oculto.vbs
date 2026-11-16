' Melting · Gestão de Não Conformidades
' Inicia o servidor SEM janela (usado na inicialização do Windows).
' Para parar: parar-servidor.bat   |   Endereços: data\ENDERECOS.txt   |   Log: data\servidor.log
Option Explicit
Dim sh, fso, pasta, pyw
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta

pyw = "pythonw"
If fso.FileExists(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python313\pythonw.exe") Then
  pyw = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python313\pythonw.exe"
End If

' 0 = sem janela, False = não espera terminar
sh.Run """" & pyw & """ """ & pasta & "\server.py""", 0, False
