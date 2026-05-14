import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'Navora',
    description: 'AI browser automation runtime — Navora',
    version: '0.2.0',
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'tabs',
      'nativeMessaging',
      'sidePanel',
      'cookies',
      'webRequest',
    ],
    host_permissions: ['<all_urls>'],
  },
});