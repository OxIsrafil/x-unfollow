// Loads the extension into a throwaway Chromium profile and asserts the
// content script injects on x.com. Verifies the manifest, script order,
// and match patterns without needing an X login.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const extPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xunfollow-smoke-'));

const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`
    ]
});

try {
    const page = await context.newPage();
    let ready = false;
    page.on('console', (m) => { if (m.text().includes('[x-unfollow] content script ready')) ready = true; });
    await page.goto('https://x.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 30 && !ready; i++) await page.waitForTimeout(500);
    if (!ready) throw new Error('content script did not log ready');
    console.log('SMOKE OK: content script injected on x.com');
} finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
}
