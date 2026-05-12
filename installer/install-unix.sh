#!/bin/bash
# AI Browser Runtime - macOS/Linux Installer
# One-command installer for AI Browser Runtime daemon and native messaging
# Run as: ./install-unix.sh

set -e

INSTALL_DIR="${INSTALL_DIR:-$HOME/.ai-browser-runtime}"
DAEMON_URL=""
SKIP_CHROME=false
VERBOSE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_step() {
    echo -e "${CYAN}[+]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERR]${NC} $1"
}

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --skip-chrome)
            SKIP_CHROME=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "AI Browser Runtime Installer"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --install-dir DIR    Installation directory (default: ~/.ai-browser-runtime)"
            echo "  --skip-chrome       Skip Chrome/Edge native messaging registration"
            echo "  --verbose           Enable verbose output"
            echo "  --help, -h          Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

MANIFEST_NAME="com.ai-browser-runtime.nm"
APP_NAME="AI Browser Runtime"

echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  $APP_NAME Installer${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Step 1: Create installation directory
log_step "Creating installation directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/daemon" "$INSTALL_DIR/shim" "$INSTALL_DIR/nm-manifest"
log_success "Installation directory ready"

# Step 2: Build daemon from source
log_step "Building daemon from source"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DAEMON_SRC_DIR="$PROJECT_ROOT/apps/daemon"

if [ -f "$DAEMON_SRC_DIR/package.json" ]; then
    log_info "Building TypeScript daemon..."

    cd "$PROJECT_ROOT"

    # Check for pnpm or npm
    if command -v pnpm &> /dev/null; then
        pnpm install --filter @ai-browser-runtime/daemon 2>/dev/null || true
        pnpm --filter @ai-browser-runtime/daemon build 2>/dev/null || true
    elif command -v npm &> /dev/null; then
        npm install 2>/dev/null || true
        npx tsc -p apps/daemon/tsconfig.json 2>/dev/null || true
    fi

    # Copy built files
    DAEMON_DIST_FROM_SRC="$PROJECT_ROOT/apps/daemon/dist"
    if [ -d "$DAEMON_DIST_FROM_SRC" ]; then
        cp -r "$DAEMON_DIST_FROM_SRC"/* "$INSTALL_DIR/daemon/"
    fi
else
    log_info "No source found, using pre-built daemon if available"
fi

log_success "Daemon ready at $INSTALL_DIR/daemon"

# Step 3: Create NM Shim
log_step "Creating Native Messaging Shim"

SHIM_PATH="$INSTALL_DIR/shim/shim.js"

cat > "$SHIM_PATH" << 'SHIM_EOF'
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
SHIM_EOF

chmod +x "$SHIM_PATH"
log_success "NM Shim created at $SHIM_PATH"

# Step 4: Create Native Messaging manifest
log_step "Creating Native Messaging manifest"

MANIFEST_PATH="$INSTALL_DIR/nm-manifest/$MANIFEST_NAME.json"

cat > "$MANIFEST_PATH" << EOF
{
  "name": "$MANIFEST_NAME",
  "description": "AI Browser Runtime Native Messaging Host",
  "path": "$SHIM_PATH",
  "type": "stdio"
}
EOF

log_success "Manifest created at $MANIFEST_PATH"

# Step 5: Register with Chrome
if [ "$SKIP_CHROME" != "true" ]; then
    log_step "Registering with Chrome"

    # Detect OS
    OS="$(uname -s)"
    case "$OS" in
        Darwin)
            # macOS
            CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
            mkdir -p "$CHROME_NM_DIR"
            ln -sf "$MANIFEST_PATH" "$CHROME_NM_DIR/$MANIFEST_NAME.json"

            # Edge (macOS)
            EDGE_NM_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
            mkdir -p "$EDGE_NM_DIR"
            ln -sf "$MANIFEST_PATH" "$EDGE_NM_DIR/$MANIFEST_NAME.json"

            log_success "Registered with Chrome/Edge on macOS"
            ;;
        Linux)
            # Check for Chrome vs Chromium
            if [ -d "$HOME/.config/google-chrome" ]; then
                CHROME_NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
                mkdir -p "$CHROME_NM_DIR"
                ln -sf "$MANIFEST_PATH" "$CHROME_NM_DIR/$MANIFEST_NAME.json"
            elif [ -d "$HOME/.config/chromium" ]; then
                CHROME_NM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
                mkdir -p "$CHROME_NM_DIR"
                ln -sf "$MANIFEST_PATH" "$CHROME_NM_DIR/$MANIFEST_NAME.json"
            fi

            # Edge (Linux)
            if [ -d "$HOME/.config/microsoft-edge" ]; then
                EDGE_NM_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
                mkdir -p "$EDGE_NM_DIR"
                ln -sf "$MANIFEST_PATH" "$EDGE_NM_DIR/$MANIFEST_NAME.json"
            fi

            log_success "Registered with Chrome/Edge on Linux"
            ;;
    esac
fi

# Step 6: Create launcher script
log_step "Creating launcher script"

LAUNCHER_PATH="$INSTALL_DIR/launch.sh"

cat > "$LAUNCHER_PATH" << 'LAUNCHER_EOF'
#!/bin/bash
# AI Browser Runtime Launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"

# Generate auth token
TOKEN="abr_$(head -c 100 /dev/urandom | base64 | head -c 20)"

# Set environment for shim
export NAVORA_RUNTIME_TOKEN="$TOKEN"
export NAVORA_RUNTIME_HOST="127.0.0.1"
export NAVORA_RUNTIME_PORT="51432"

# Start daemon in background
DAEMON_SCRIPT="$INSTALL_DIR/daemon/dist/index.js"
if [ -f "$DAEMON_SCRIPT" ]; then
    node "$DAEMON_SCRIPT" &
    echo "Daemon started"
fi

# Start shim
SHIM_SCRIPT="$INSTALL_DIR/shim/shim.js"
exec node "$SHIM_SCRIPT"
LAUNCHER_EOF

chmod +x "$LAUNCHER_PATH"
log_success "Launcher created at $LAUNCHER_PATH"

# Summary
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Installation Complete!${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "Installation directory: $INSTALL_DIR"
echo "Native Messaging manifest: $MANIFEST_PATH"
echo ""
echo "Next steps:"
echo "  1. Restart Chrome"
echo "  2. Install the AI Browser Runtime extension"
echo "  3. The extension will automatically connect to the daemon"
echo ""
echo "To start manually: $LAUNCHER_PATH"
echo ""