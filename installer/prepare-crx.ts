/**
 * CRX Preparation Script
 * Prepares the extension for Chrome Web Store signing
 * 
 * Usage: npx tsx prepare-crx.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTENSION_DIR = path.join(PROJECT_ROOT, "apps", "extension");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "dist");

interface CrxConfig {
  appId: string;
  updateUrl?: string;
  keyPath?: string;
  zipPath?: string;
}

interface Manifest {
  manifest_version: number;
  name: string;
  description: string;
  version: string;
  icons?: Record<string, string>;
  action?: Record<string, unknown>;
  background?: Record<string, unknown>;
  permissions?: string[];
  host_permissions?: string[];
  side_panel?: Record<string, unknown>;
  content_scripts?: Record<string, unknown>[];
}

function log(message: string): void {
  console.log(`[CRX] ${message}`);
}

function error(message: string): void {
  console.error(`[CRX ERROR] ${message}`);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cleanDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Step 1: Build the extension
 */
function buildExtension(): void {
  log("Building extension...");

  try {
    // Run WXT build
    execSync("pnpm --filter @navora/extension build", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    log("Extension built successfully");
  } catch (err) {
    error(`Failed to build extension: ${err}`);
    process.exit(1);
  }
}

/**
 * Step 2: Validate manifest
 */
function validateManifest(distDir: string): Manifest {
  const manifestPath = path.join(distDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    error("manifest.json not found in dist directory");
    process.exit(1);
  }

  const content = fs.readFileSync(manifestPath, "utf-8");
  const manifest: Manifest = JSON.parse(content);

  // Validate required fields
  if (!manifest.name) {
    error("Manifest missing 'name' field");
    process.exit(1);
  }

  if (!manifest.version) {
    error("Manifest missing 'version' field");
    process.exit(1);
  }

  if (!manifest.manifest_version) {
    error("Manifest missing 'manifest_version' field");
    process.exit(1);
  }

  log(`Manifest validated: ${manifest.name} v${manifest.version} (MV${manifest.manifest_version})`);

  return manifest;
}

/**
 * Step 3: Prepare package directory
 */
function preparePackageDir(distDir: string, outputDir: string): string {
  const packageDir = path.join(outputDir, "package");
  cleanDir(packageDir);

  // Copy dist contents to package directory
  const files = fs.readdirSync(distDir);
  for (const file of files) {
    const src = path.join(distDir, file);
    const dest = path.join(packageDir, file);
    const stat = fs.statSync(src);

    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  log(`Package prepared at: ${packageDir}`);
  return packageDir;
}

/**
 * Step 4: Create ZIP package
 */
function createZip(packageDir: string, outputDir: string): string {
  const zipPath = path.join(outputDir, "extension.zip");

  // Remove existing zip
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Create zip using PowerShell (Windows) or zip (Unix)
  const platform = os.platform();

  if (platform === "win32") {
    // Use PowerShell to create zip
    execSync(
      `Compress-Archive -Path "${packageDir}\\*" -DestinationPath "${zipPath}"`,
      { stdio: "inherit" }
    );
  } else {
    // Use zip command
    execSync(`cd "${packageDir}" && zip -r "${zipPath}" .`, {
      stdio: "inherit",
    });
  }

  log(`ZIP created: ${zipPath}`);
  return zipPath;
}

/**
 * Step 5: Generate signing notes
 */
function generateSigningNotes(config: CrxConfig, manifest: Manifest): void {
  const notesPath = path.join(OUTPUT_DIR, "SIGNING_INSTRUCTIONS.md");

  const instructions = `# Chrome Web Store Signing Instructions

## Extension Details
- **Name**: ${manifest.name}
- **Version**: ${manifest.version}
- **App ID**: ${config.appId}

## Pre-upload Checklist
- [ ] Extension builds without errors
- [ ] Manifest validates correctly
- [ ] All permissions are necessary
- [ ] Privacy policy URL is provided
- [ ] Store listing assets are ready (icon, screenshots)

## Upload Options

### Option 1: Chrome Web Store (Recommended)
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Create a new item or update existing
3. Upload the ZIP file: \`dist/extension.zip\`
4. Fill in store listing details
5. Submit for review

### Option 2: Self-signed CRX (Development only)
For local testing, you can create a self-signed CRX:
\`\`\`bash
# Install crxmake
npm install -g crxmake

# Create CRX
crxmake --pack-extension=dist/package --output-file=dist/extension.crx --private-key=path/to/key.pem
\`\`\`

## After Signing
1. Download the signed CRX from Chrome Web Store
2. Verify the CRX is valid
3. Test the extension loads in Chrome

## Important Notes
- CRX signing requires a Chrome Web Store developer account
- New extensions need review before publishing
- Updates also require review (can take 1-3 days)
`;

  fs.writeFileSync(notesPath, instructions, "utf-8");
  log(`Signing instructions written to: ${notesPath}`);
}

/**
 * Main function
 */
function main(): void {
  log("Starting CRX preparation...");

  // Ensure output directory exists
  ensureDir(OUTPUT_DIR);

  // Step 1: Build
  buildExtension();

  // Step 2: Validate
  const distDir = path.join(EXTENSION_DIR, "dist", "chrome-mv3");
  const manifest = validateManifest(distDir);

  // Step 3: Prepare package
  preparePackageDir(distDir, OUTPUT_DIR);

  // Step 4: Create ZIP
  const zipPath = createZip(path.join(OUTPUT_DIR, "package"), OUTPUT_DIR);

  // Step 5: Generate signing instructions
  const config: CrxConfig = {
    appId: "ai-browser-runtime-extension",
    zipPath,
  };
  generateSigningNotes(config, manifest);

  log("CRX preparation complete!");
  log(`Output directory: ${OUTPUT_DIR}`);
  log(`Next steps: Review SIGNING_INSTRUCTIONS.md and upload to Chrome Web Store`);
}

main();