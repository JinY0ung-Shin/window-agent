#!/usr/bin/env node
/**
 * Download Chromium for bundling into the Tauri app.
 * Run before `cargo tauri build` to include Chromium in the installer.
 * Cross-platform (works on Windows, macOS, Linux without bash).
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SIDECAR_DIR = path.resolve(__dirname, '..', 'browser-sidecar');
const BROWSERS_DIR = path.join(SIDECAR_DIR, 'playwright-browsers');

console.log('=== Preparing bundled Chromium ===');
console.log(`Target: ${BROWSERS_DIR}`);

// Install only Chromium via Playwright CLI
// Note: require.resolve('playwright-core/cli') fails with ERR_PACKAGE_PATH_NOT_EXPORTED
// on newer Node.js, so we reference the cli.js file directly.
const playwrightCli = path.join(SIDECAR_DIR, 'node_modules', 'playwright', 'cli.js');
execFileSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR },
  cwd: SIDECAR_DIR,
});

// Get installed revision for verification
const browsersJson = require(path.join(SIDECAR_DIR, 'node_modules', 'playwright-core', 'browsers.json'));
const chromiumEntry = browsersJson.browsers.find(b => b.name === 'chromium');
const revision = chromiumEntry ? chromiumEntry.revision : 'unknown';
console.log(`Chromium revision: ${revision}`);

// Verify the download exists
const revisionDir = path.join(BROWSERS_DIR, `chromium-${revision}`);
if (fs.existsSync(revisionDir)) {
  console.log(`OK: Chromium directory exists at ${revisionDir}`);
} else {
  console.error(`FAIL: Chromium directory not found at ${revisionDir}`);
  process.exit(1);
}

console.log('=== Chromium preparation complete ===');
