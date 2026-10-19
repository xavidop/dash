# Adds Dash to the current user's Startup folder so it launches at login.
# Run once:  powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1
# Remove:    powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1 -Remove
param([switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Dash.lnk'

if ($Remove) {
  Remove-Item $lnk -ErrorAction SilentlyContinue
  Write-Host "Dash removed from startup."
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $root 'start.bat'
$sc.WorkingDirectory = $root
$sc.WindowStyle = 7   # minimized
$sc.Description = 'Dash smart display'
$sc.Save()
Write-Host "Dash will start at login: $lnk"
