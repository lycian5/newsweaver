Option Explicit
' Start a Node script with no console window (window style 0).
Dim fso, sh, root, target, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
If WScript.Arguments.Count > 0 Then
  target = WScript.Arguments(0)
Else
  target = "scripts\agent-reach-runner.js"
End If
If InStr(target, "\") = 0 And InStr(target, "/") = 0 Then
  target = "scripts\" & target
End If
sh.CurrentDirectory = root
cmd = "node """ & root & "\" & Replace(target, "/", "\") & """"
If WScript.Arguments.Count > 1 Then
  cmd = cmd & " " & WScript.Arguments(1)
End If
sh.Run cmd, 0, False
