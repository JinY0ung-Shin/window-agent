$vsDevCmd = "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

$output = cmd /c "`"$vsDevCmd`" -arch=amd64 >nul 2>&1 && set"
foreach ($line in $output) {
    if ($line -match "^(.*?)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

Set-Location "C:\Users\gojam\window-agent"
& pnpm tauri dev 2>&1
