$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message"
}

function Invoke-NativeCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        $joinedArguments = $Arguments -join " "
        throw "$Command $joinedArguments failed with exit code $LASTEXITCODE"
    }
}

Write-Step "Fetching latest upstream/main"
Invoke-NativeCommand "git" @("fetch", "upstream", "main")

Write-Step "Fast-forwarding current branch with upstream/main if possible"
try {
    Invoke-NativeCommand "git" @("merge", "--ff-only", "upstream/main")
} catch {
    throw "Could not fast-forward the current branch with upstream/main. Update this branch manually, resolve any conflicts, then rerun this script."
}

if (-not (Test-Path -Path "./flask-server" -PathType Container)) {
    throw "Missing ./flask-server. The Flask Docker server has not been merged yet or is not present on the current branch. Run this script from a branch that contains the Flask Docker server files."
}

Write-Step "Installing npm dependencies"
Invoke-NativeCommand "npm" @("ci")

Write-Step "Running format check"
Invoke-NativeCommand "npm" @("run", "format:check")

Write-Step "Running lint"
Invoke-NativeCommand "npm" @("run", "lint")

Write-Step "Running security audit"
Invoke-NativeCommand "npm" @("run", "security")

Write-Step "Running unit tests"
Invoke-NativeCommand "npm" @("test")

Write-Step "Installing Playwright Chromium if needed"
Invoke-NativeCommand "npx" @("playwright", "install", "chromium")

Write-Step "Running smoke tests"
Invoke-NativeCommand "npm" @("run", "smoke")

Write-Step "Building Flask Docker image"
Invoke-NativeCommand "docker" @(
    "build",
    "-t",
    "focuskit-flask-server",
    "./flask-server"
)

Write-Step "Removing existing focuskit-prod container if present"
$existingContainer = docker ps -a --filter "name=^/focuskit-prod$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) {
    throw "docker ps failed with exit code $LASTEXITCODE"
}
if ($existingContainer -eq "focuskit-prod") {
    Invoke-NativeCommand "docker" @("rm", "-f", "focuskit-prod")
}

Write-Step "Starting focuskit-prod container"
Invoke-NativeCommand "docker" @(
    "run",
    "-d",
    "--name",
    "focuskit-prod",
    "-p",
    "5000:5000",
    "focuskit-flask-server"
)

Write-Step "Verifying deployment health endpoint"
$healthUrl = "http://localhost:5000/api/health"
$healthResponse = $null

for ($attempt = 1; $attempt -le 10; $attempt++) {
    try {
        $healthResponse = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5
        if (
            $healthResponse.status -eq "ok" -and
            $healthResponse.service -eq "focuskit-flask-server"
        ) {
            Write-Host ""
            Write-Host "Deployment succeeded. FocusKit Flask Server is running at http://localhost:5000"
            exit 0
        }
    } catch {
        if ($attempt -eq 10) {
            throw
        }
    }

    Start-Sleep -Seconds 1
}

throw "Deployment health check failed for $healthUrl"
