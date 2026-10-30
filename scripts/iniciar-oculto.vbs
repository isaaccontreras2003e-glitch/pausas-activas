' Arranca Pausas Activas QR en segundo plano, sin ventana.
' Lo usa el acceso directo de la carpeta Inicio de Windows (ACTIVAR-SISTEMA.bat lo crea).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = raiz
' Si se instaló con el instalador, usa el motor incluido; si no, el Node.js del equipo.
nodo = "node"
If fso.FileExists(raiz & "\runtime\node.exe") Then nodo = """" & raiz & "\runtime\node.exe"""
sh.Run nodo & " --disable-warning=ExperimentalWarning """ & raiz & "\server\servicio.js""", 0, False
