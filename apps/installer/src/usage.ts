export function usageInstructions(): string {
  return `
Después de instalar los MCP:

• Claude Code: reinicia Claude Code y comprueba que el servidor MCP "navora" esté activo.
• Cursor: Settings → MCP → verifica el servidor o reinicia Cursor.

Variables útiles (opcional):
  NAVORA_CDP_PORT   Puerto CDP de Chrome (por defecto se prueba 9222–9224)
  NAVORA_DAEMON_PORT Puerto WebSocket del daemon (51520)
  NAVORA_AUTH_SECRET   Secreto del handshake con el daemon

Chrome debe exponer CDP (el plugin puede lanzar Chrome con depuración remota) o arranca manualmente:
  chrome --remote-debugging-port=9222

Diagnóstico rápido:
  npx navora   → este instalador (estado y test de conexión)
`.trim();
}
