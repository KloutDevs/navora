# AI Browser Runtime - Windows Installer
# One-command installer for AI Browser Runtime daemon and native messaging
# Run as: powershell -ExecutionPolicy Bypass -File install-windows.ps1

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\ai-browser-runtime",
    [string]$DaemonUrl = "",
    [switch]$SkipChrome = $false
)

$ErrorActionPreference = "Stop"

$MANIFEST_NAME = "com.ai-browser-runtime.nm"
$APP_NAME = "AI Browser Runtime"

function Write-Step {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERR] $Message" -ForegroundColor Red
}

function Test-AdminRights {
    # Native messaging for current user doesn't require admin rights
    return $false
}

# Ensure PowerShell uses TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  $APP_NAME Installer" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# Step 1: Create installation directory
Write-Step "Creating installation directory: $InstallDir"
try {
    if (-not (Test-Path -LiteralPath $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Write-Success "Installation directory ready"
} catch {
    Write-Error "Failed to create directory: $_"
    exit 1
}

# Step 2: Build or copy daemon
Write-Step "Building daemon from source"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DaemonSrcDir = Join-Path $ProjectRoot "apps\daemon"
$DaemonDistDir = Join-Path $InstallDir "daemon"

try {
    # Check if we have source to build
    if (Test-Path (Join-Path $DaemonSrcDir "package.json")) {
        Write-Host "  Building TypeScript daemon..." -ForegroundColor Gray

        # Use pnpm to build if available, otherwise use npx
        $BuildCmd = "pnpm install --filter @ai-browser-runtime/daemon && pnpm --filter @ai-browser-runtime/daemon build"
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            $BuildCmd = "npm install && npx tsc -p apps/daemon/tsconfig.json"
        }

        Push-Location $ProjectRoot
        try {
            Invoke-Expression $BuildCmd 2>&1 | Out-Null
        } finally {
            Pop-Location
        }

        # Copy built files
        $DaemonDistFromSrc = Join-Path $ProjectRoot "apps\daemon\dist"
        if (Test-Path $DaemonDistFromSrc) {
            Copy-Item -Path $DaemonDistFromSrc -Destination $DaemonDistDir -Recurse -Force
        }
    } else {
        # Just ensure directory exists
        New-Item -ItemType Directory -Path $DaemonDistDir -Force | Out-Null
    }
    Write-Success "Daemon ready at $DaemonDistDir"
} catch {
    Write-Error "Failed to build daemon: $_"
    exit 1
}

# Step 3: Create NM Shim script
Write-Step "Creating Native Messaging Shim"
$ShimDir = Join-Path $InstallDir "shim"
New-Item -ItemType Directory -Path $ShimDir -Force | Out-Null

# Create a Node.js wrapper script that forwards to the daemon
$ShimScript = @"
#!/usr/bin/env node
/**
 * AI Browser Runtime - Native Messaging Shim
 * Forwards messages from Chrome to the daemon via WebSocket
 */

const net = require('net');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 51432;
const RECONNECT_DELAY = 3000;

let socket = null;
let connectTimeout = null;
let messageBuffer = '';

// Read configuration from environment
const config = {
    host: process.env.NAVORA_RUNTIME_HOST || DEFAULT_HOST,
    port: parseInt(process.env.NAVORA_RUNTIME_PORT || String(DEFAULT_PORT), 10),
    token: process.env.NAVORA_RUNTIME_TOKEN || ''
};

function connect() {
    if (socket && socket.writable) return;

    socket = net.createConnection(config.port, config.host);

    socket.on('connect', () => {
        console.error('[NM Shim] Connected to daemon');
        // Send handshake with auth token
        if (config.token) {
            const handshake = JSON.stringify({
                type: 'handshake',
                token: config.token
            });
            const framed = frameMessage(handshake);
            socket.write(framed);
        }
    });

    socket.on('data', (data) => {
        messageBuffer += data.toString();
        processMessages();
    });

    socket.on('error', (err) => {
        console.error('[NM Shim] Socket error:', err.message);
        socket = null;
        scheduleReconnect();
    });

    socket.on('close', () => {
        console.error('[NM Shim] Connection closed');
        socket = null;
        scheduleReconnect();
    });
}

function scheduleReconnect() {
    if (connectTimeout) return;
    connectTimeout = setTimeout(() => {
        connectTimeout = null;
        connect();
    }, RECONNECT_DELAY);
}

function frameMessage(json) {
    const length = Buffer.byteLength(json, 'utf8');
    const lengthBytes = Buffer.alloc(4);
    lengthBytes.writeUInt32BE(length, 0);
    return Buffer.concat([lengthBytes, Buffer.from(json, 'utf8')]);
}

function processMessages() {
    while (messageBuffer.length >= 4) {
        const length = messageBuffer.readUInt32BE(0);
        if (messageBuffer.length >= 4 + length) {
            const message = messageBuffer.substring(4, 4 + length);
            messageBuffer = messageBuffer.substring(4 + length);
            // Forward to stdout in Chrome's native messaging format
            process.stdout.write(message + '\n');
        } else {
            break;
        }
    }
}

// Read messages from stdin (Chrome sends them)
let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    stdinBuffer += chunk;
    processStdinMessages();
});

function processStdinMessages() {
    // Native messaging uses newlines as message delimiters
    const lines = stdinBuffer.split('\n');
    stdinBuffer = lines.pop() || '';

    for (const line of lines) {
        if (!line.trim()) continue;

        // Forward to daemon
        if (socket && socket.writable) {
            const framed = frameMessage(line);
            socket.write(framed);
        }
    }
}

// Start connection
connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
    if (socket) socket.end();
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (socket) socket.end();
    process.exit(0);
});
"@

$ShimPath = Join-Path $ShimDir "shim.js"
Set-Content -Path $ShimPath -Value $ShimScript -Encoding UTF8
Write-Success "NM Shim created at $ShimPath"

# Step 4: Create Native Messaging manifest
Write-Step "Creating Native Messaging manifest"
$ManifestDir = Join-Path $InstallDir "nm-manifest"
New-Item -ItemType Directory -Path $ManifestDir -Force | Out-Null

$ManifestPath = Join-Path $ManifestDir "$MANIFEST_NAME.json"
$ManifestContent = @{
    name = $MANIFEST_NAME
    description = "AI Browser Runtime Native Messaging Host"
    path = $ShimPath.Replace('\', '/')
    type = "stdio"
} | ConvertTo-Json -Depth 2

Set-Content -Path $ManifestPath -Value $ManifestContent -Encoding UTF8
Write-Success "Manifest created at $ManifestPath"

# Step 5: Register with Chrome (Windows Registry)
if (-not $SkipChrome) {
    Write-Step "Registering with Chrome"

    $RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$MANIFEST_NAME"
    try {
        # Check if Chrome is installed
        $ChromePath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts"
        if (-not (Test-Path $ChromePath)) {
            New-Item -Path $ChromePath -Force | Out-Null
        }

        Set-ItemProperty -Path $ChromePath -Name $MANIFEST_NAME -Value $ManifestPath -ErrorAction SilentlyContinue

        # Fallback to edge if Chrome not found
        if (-not (Get-ItemProperty -Path $ChromePath -Name $MANIFEST_NAME -ErrorAction SilentlyContinue)) {
            $EdgePath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
            if (-not (Test-Path $EdgePath)) {
                New-Item -Path $EdgePath -Force | Out-Null
            }
            Set-ItemProperty -Path $EdgePath -Name $MANIFEST_NAME -Value $ManifestPath -ErrorAction SilentlyContinue
        }

        Write-Success "Registered with Chrome/Edge"
    } catch {
        Write-Error "Failed to register: $_"
    }
}

# Step 6: Create launcher script
Write-Step "Creating launcher script"
$LauncherPath = Join-Path $InstallDir "launch.ps1"
$LauncherContent = @"
# AI Browser Runtime Launcher
`$ErrorActionPreference = "Stop"

`$InstallDir = Split-Path -Parent `$PSScriptRoot

# Generate auth token
`$Token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("abr_$(Get-Random -Maximum 999999)"))

# Set environment for shim
`$env:NAVORA_RUNTIME_TOKEN = `$Token
`$env:NAVORA_RUNTIME_HOST = "127.0.0.1"
`$env:NAVORA_RUNTIME_PORT = "51432"

# Start daemon in background
`$DaemonScript = Join-Path `$InstallDir "daemon\dist\index.js"
if (Test-Path `$DaemonScript) {
    Start-Process node -ArgumentList `$DaemonScript -WindowStyle Hidden
    Write-Host "Daemon started" -ForegroundColor Green
}

# Start shim
`$ShimScript = Join-Path `$InstallDir "shim\shim.js"
node `$ShimScript
"@

Set-Content -Path $LauncherPath -Value $LauncherContent -Encoding UTF8
Write-Success "Launcher created at $LauncherPath"

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Installation Complete!" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Installation directory: $InstallDir" -ForegroundColor White
Write-Host "Native Messaging manifest: $ManifestPath" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart Chrome" -ForegroundColor White
Write-Host "  2. Install the AI Browser Runtime extension" -ForegroundColor White
Write-Host "  3. The extension will automatically connect to the daemon" -ForegroundColor White
Write-Host ""
Write-Host "To start manually: node `"$LauncherPath`"" -ForegroundColor Gray
Write-Host ""