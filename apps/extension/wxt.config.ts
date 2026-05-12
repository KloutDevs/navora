import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'AI Browser Runtime',
    description: 'AI-powered browser automation extension',
    version: '0.1.0',
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