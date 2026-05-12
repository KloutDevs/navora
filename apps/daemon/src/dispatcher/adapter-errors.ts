/**
 * Errors when resolving BrowserAdapter from AdapterRegistry (NM vs CDP routing).
 */

export class ExtensionNotConnectedError extends Error {
  readonly code = "EXTENSION_NOT_CONNECTED";

  constructor(profileId: string) {
    super(
      `Native Messaging browser adapter not connected for profile "${profileId}". ` +
        `Ensure the Chrome extension is loaded and the NM shim can reach this daemon (registry key nm:${profileId}).`
    );
    this.name = "ExtensionNotConnectedError";
  }
}

export class CdpNotAvailableError extends Error {
  readonly code = "CDP_NOT_AVAILABLE";

  constructor(port: number) {
    super(
      `Direct CDP adapter is not registered for port ${port}. ` +
        `Start Chrome with remote debugging on that port or register cdp:${port} in the adapter registry.`
    );
    this.name = "CdpNotAvailableError";
  }
}
