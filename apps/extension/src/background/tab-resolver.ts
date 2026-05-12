/**
 * Resolve Chrome tab IDs for NM handlers.
 */

export async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined && tabId > 0) {
    const t = await chrome.tabs.get(tabId);
    if (t?.id !== undefined) return t.id;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) {
    throw new Error("No active tab");
  }
  return id;
}

export async function navigateAndWait(tabId: number, url: string, timeoutMs = 15000): Promise<void> {
  await chrome.tabs.update(tabId, { url });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Navigation timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}
