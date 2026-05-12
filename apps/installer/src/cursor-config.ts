import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Clave canónica del servidor MCP Navora en Cursor. */
export const CURSOR_MCP_SERVER_KEY = 'navora';

function cursorBaseDir(): string {
  const testHome = process.env['NAVORA_TEST_CURSOR_HOME'];
  if (testHome !== undefined && testHome !== '') {
    return testHome;
  }
  return homedir();
}

function cursorMcpPath(): string {
  return join(cursorBaseDir(), '.cursor', 'mcp.json');
}

/**
 * Fusiona la entrada en `~/.cursor/mcp.json` sin borrar otros servidores MCP.
 */
export function upsertCursorMcpServer(serverKey: string, entry: McpServerEntry): string {
  const mcpPath = cursorMcpPath();
  mkdirSync(dirname(mcpPath), { recursive: true });

  let doc: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try {
      doc = JSON.parse(readFileSync(mcpPath, 'utf8')) as typeof doc;
    } catch {
      doc = {};
    }
  }
  if (!doc.mcpServers) doc.mcpServers = {};
  doc.mcpServers[serverKey] = entry;
  writeFileSync(mcpPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return mcpPath;
}

/**
 * Elimina una o más claves de `mcpServers`. Devuelve si se modificó el archivo.
 */
export function removeCursorMcpServers(keys: string[]): boolean {
  const mcpPath = cursorMcpPath();
  if (!existsSync(mcpPath) || keys.length === 0) return false;

  let doc: { mcpServers?: Record<string, unknown> };
  try {
    doc = JSON.parse(readFileSync(mcpPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
  } catch {
    return false;
  }

  const servers = doc.mcpServers;
  if (!servers) return false;

  let changed = false;
  for (const k of keys) {
    if (k in servers) {
      delete servers[k];
      changed = true;
    }
  }
  if (!changed) return false;

  writeFileSync(mcpPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return true;
}

export interface CursorMcpInfo {
  configured: boolean;
  key: string | null;
}

/**
 * Comprueba si `~/.cursor/mcp.json` define el MCP Navora.
 * Reconoce: claves que contengan "navora", o args que apunten a navora-*-plugin.
 * Devuelve la clave encontrada para poder limpiarla en reinstalaciones.
 */
export function isCursorNavoraConfigured(): CursorMcpInfo {
  const mcpPath = cursorMcpPath();
  if (!existsSync(mcpPath)) return { configured: false, key: null };

  try {
    const doc = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers?: Record<string, McpServerEntry | unknown>;
    };
    const servers = doc.mcpServers ?? {};
    for (const [key, val] of Object.entries(servers)) {
      if (/navora/i.test(key)) return { configured: true, key };
      if (val && typeof val === 'object' && 'args' in val && Array.isArray((val as McpServerEntry).args)) {
        const args = (val as McpServerEntry).args.map((a) => String(a));
        if (args.some((a) => /navora-(claude|cursor)-plugin/i.test(a))) {
          return { configured: true, key };
        }
      }
    }
  } catch {
    return { configured: false, key: null };
  }
  return { configured: false, key: null };
}
