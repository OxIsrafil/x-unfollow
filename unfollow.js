// x-unfollow
// Paced bulk unfollow tool for X (x.com).
// Opens a visible Chromium window, walks your /following list and unfollows
// with human-like pacing. Hard daily cap, protected-handles list, typed
// confirmation before anything runs. No API keys, nothing leaves your machine.

import { chromium } from 'playwright-ghost';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import readline from 'readline';

const STORAGE_FILE = 'auth.json';                    // saved X session; keep private, never commit
const STATE_FILE = 'unfollow_daily_state.json';      // daily counter, resets each local calendar day
const PROTECT_FILE = 'unfollow_protect_handles.txt'; // one handle per line, never unfollowed
const DAILY_MAX = 600;                               // hard ceiling per local calendar day
const SESSION_DEFAULT = 35;                          // default unfollows per run

const BROWSER_LAUNCH_OPTIONS = {
    headless: false, // always visible so you can watch and intervene
    slowMo: 50,
    handleSIGINT: false,
    handleSIGTERM: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--no-service-autorun',
        '--password-store=basic',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,720',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ]
};

// --- logging ---

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = {
    info: (m) => console.log(`${ts()} - info: ${m}`),
    warn: (m) => console.warn(`${ts()} - warn: ${m}`),
    error: (m) => console.error(`${ts()} - error: ${m}`)
};

// --- graceful stop ---

let shouldStop = false;
process.on('SIGINT', () => {
    if (shouldStop) process.exit(1);
    shouldStop = true;
    console.log('\nStopping after the current step... (Ctrl+C again to force quit)');
});

// --- small utils ---

function randomBetweenMs(min, max) {
    return Math.floor(min + Math.random() * (max - min));
}

function getUnfollowBetweenMs() {
    return randomBetweenMs(20 * 1000, 50 * 1000);   // 20-50 seconds between each unfollow
}

function getUnfollowBatchRestMs() {
    return randomBetweenMs(4 * 60 * 1000, 10 * 60 * 1000);  // 4-10 minute break every 10 unfollows
}

function getLocalDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// --- persisted state ---

async function loadDailyState() {
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf8');
        const j = JSON.parse(raw);
        const today = getLocalDateKey();
        if (!j.date || j.date !== today) return { date: today, count: 0 };
        const count = Math.min(DAILY_MAX, Math.max(0, parseInt(j.count, 10) || 0));
        return { date: today, count };
    } catch {
        return { date: getLocalDateKey(), count: 0 };
    }
}

async function saveDailyState(state) {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadProtectedHandles() {
    try {
        const raw = await fs.readFile(PROTECT_FILE, 'utf8');
        return new Set(
            raw
                .split(/\r?\n/)
                .map((l) => l.split('#')[0].trim().replace(/^@/, '').toLowerCase())
                .filter(Boolean)
        );
    } catch {
        return new Set();
    }
}

// --- modal handling ---

async function clickAny(page, modal, selectors = []) {
    for (const s of selectors) {
        const el = await modal.$(s);
        if (el) {
            await el.click().catch(() => { });
            return true;
        }
    }
    await page.keyboard.press('Escape').catch(() => { });
    return false;
}

async function waitModalGone(page, modalSelector) {
    await page.waitForSelector(modalSelector, { state: 'detached', timeout: 5000 }).catch(() => { });
}

// Dismisses interruption dialogs (errors, notices, unknown popups) so the loop
// can continue. Never touches unfollow or delete confirmations: those are only
// ever clicked by the explicit confirm step below.
async function handleModals(page) {
    const destructiveConfirmOpen = await page.evaluate(() => {
        for (const el of document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]')) {
            const t = (el.innerText || '').slice(0, 700);
            if (/delete post/i.test(t)) return true;
            if (/unfollow/i.test(t) && (/\?/.test(t) || /won't be notified|not be able to follow you|can.{0,3}t see/i.test(t))) return true;
        }
        return false;
    });
    if (destructiveConfirmOpen) return false;

    const modalSelector = 'div[role="dialog"]';
    const modal = await page.$(modalSelector);
    if (!modal) return false;

    const modalText = (await modal.innerText().catch(() => ''))?.trim() || '';
    if (/delete post/i.test(modalText)) return false;
    if (/unfollow/i.test(modalText)) return false;

    if (modalText) {
        log.warn(`Dismissing modal: "${modalText.slice(0, 50)}..."`);
        await clickAny(page, modal, ['[aria-label="Close"]', 'text=Got It']);
        await waitModalGone(page, modalSelector);
        return true;
    }

    return false;
}

// --- unfollow steps ---

/** Confirm the unfollow sheet after the menu (if X shows a second step). */
async function clickUnfollowConfirmation(page) {
    await page.waitForTimeout(randomBetweenMs(450, 900));
    await page
        .waitForFunction(
            () =>
                !!document.querySelector('[data-testid="confirmationSheetConfirmButton"]') ||
                [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some((el) =>
                    /unfollow/i.test((el.innerText || '').slice(0, 400))
                ),
            { timeout: 9000 }
        )
        .catch(() => { });

    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await page.waitForTimeout(500);

        try {
            const dlg = page.locator('[role="dialog"],[role="alertdialog"]').filter({ hasText: /unfollow/i }).first();
            if ((await dlg.count().catch(() => 0)) > 0) {
                const btn = dlg.getByRole('button', { name: /^unfollow$/i });
                if ((await btn.count().catch(() => 0)) > 0) {
                    await btn.first().click({ timeout: 8000, force: true }).catch(() => { });
                    await page.waitForTimeout(randomBetweenMs(400, 800));
                    return true;
                }
            }
        } catch (_) { /* ignore */ }

        const buttons = await page.$$('[data-testid="confirmationSheetConfirmButton"]');
        if (buttons.length > 0) {
            const btn = buttons[buttons.length - 1];
            await btn.scrollIntoViewIfNeeded().catch(() => { });
            await btn.click({ force: true, timeout: 8000 }).catch(() => { });
            await page.waitForTimeout(randomBetweenMs(400, 800));
            return true;
        }

        const done = await page.evaluate(() => {
            for (const sheet of document.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
                if (!/unfollow/i.test((sheet.innerText || '').slice(0, 500))) continue;
                const prim = sheet.querySelector('[data-testid="confirmationSheetConfirmButton"]');
                if (prim) {
                    prim.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    return true;
                }
                for (const b of sheet.querySelectorAll('button,[role="button"]')) {
                    const lab = (b.innerText || '').replace(/\s+/g, ' ').trim().split('\n')[0];
                    if (/^cancel$/i.test(lab)) continue;
                    if (/^unfollow$/i.test(lab)) {
                        b.click();
                        return true;
                    }
                }
            }
            return false;
        });
        if (done) {
            await page.waitForTimeout(randomBetweenMs(400, 800));
            return true;
        }
    }

    // Page-level fallback: any visible "Unfollow" button on the page
    const pageUnfollowBtn = page.getByRole('button', { name: /^unfollow$/i });
    if ((await pageUnfollowBtn.count().catch(() => 0)) > 0) {
        await pageUnfollowBtn.first().click({ force: true, timeout: 6000 }).catch(() => { });
        await page.waitForTimeout(randomBetweenMs(400, 800));
        return true;
    }

    return false;
}

/**
 * Unfollow one account from the visible /following rows.
 * Skips protected handles, your own handle, and rows without a Following button.
 */
async function unfollowFirstEligibleRow(page, protectedSet, myHandleNorm) {
    const cells = await page.$$('[data-testid="UserCell"]');

    for (let idx = 0; idx < Math.min(cells.length, 30); idx++) {
        const cell = cells[idx];
        const handleFromRow = await cell
            .evaluate((el) => {
                const links = el.querySelectorAll('a[href^="/"]');
                for (const a of links) {
                    const path = (a.getAttribute('href') || '').split('?')[0];
                    const parts = path.split('/').filter(Boolean);
                    if (parts.length === 1 && !['i', 'home', 'explore', 'settings', 'messages', 'notifications', 'compose', 'search'].includes(parts[0].toLowerCase())) {
                        return parts[0];
                    }
                }
                return null;
            })
            .catch(() => null);

        if (!handleFromRow) continue;
        const hNorm = handleFromRow.toLowerCase().replace(/^@/, '');
        if (hNorm === myHandleNorm) continue;
        if (protectedSet.has(hNorm)) {
            log.info(`Skip protected @${handleFromRow}`);
            continue;
        }

        const followingHit = await cell.evaluate((el) => {
            const btns = el.querySelectorAll('[role="button"],button');
            for (const b of btns) {
                const t = (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                const lower = t.toLowerCase();
                if (lower === 'following' || /^following\s+@/i.test(t)) return true;
                if (lower.includes('following') && !lower.includes('unfollow')) {
                    const only = t.split('\n')[0].trim().toLowerCase();
                    if (only === 'following') return true;
                }
            }
            return false;
        });
        if (!followingHit) continue;

        const btnIdx = await cell.evaluate((el) => {
            const btns = el.querySelectorAll('[role="button"],button');
            for (let i = 0; i < btns.length; i++) {
                const t = (btns[i].innerText || btns[i].getAttribute('aria-label') || '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const firstLine = t.split('\n')[0].trim().toLowerCase();
                if (firstLine === 'following' || /^following\s+@/i.test(t)) return i;
            }
            return -1;
        });
        if (btnIdx < 0) continue;

        const rowBtns = await cell.$$('[role="button"],button');
        const fbEl = rowBtns[btnIdx];
        if (!fbEl) continue;

        await fbEl.click({ timeout: 6000 }).catch(() => { });
        await page.waitForTimeout(randomBetweenMs(500, 1100));

        if (await handleModals(page)) {
            await page.keyboard.press('Escape').catch(() => { });
            continue;
        }

        const items = await page.$$('[role="menuitem"]');
        let clickedMenu = false;
        for (const mi of items) {
            const tx = ((await mi.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
            if (/^unfollow(\s+@)?/i.test(tx) || /\bunfollow\b/i.test(tx)) {
                await mi.click().catch(() => { });
                clickedMenu = true;
                break;
            }
        }
        if (!clickedMenu) {
            // Check if clicking the Following button directly showed a confirmation (no menu step)
            const directConfirm = await page.evaluate(() => {
                if (document.querySelector('[data-testid="confirmationSheetConfirmButton"]')) return true;
                for (const el of document.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
                    if (/unfollow/i.test((el.innerText || '').slice(0, 500))) return true;
                }
                return false;
            });
            if (!directConfirm) {
                log.warn(`No Unfollow menu for @${handleFromRow}`);
                await page.keyboard.press('Escape').catch(() => { });
                continue;
            }
            log.info(`Direct confirmation for @${handleFromRow} (no dropdown menu)`);
            // fall through to clickUnfollowConfirmation below
        }

        await page.waitForTimeout(randomBetweenMs(700, 1400));

        if (await handleModals(page)) {
            await page.keyboard.press('Escape').catch(() => { });
            continue;
        }

        const confirmed = await clickUnfollowConfirmation(page);
        if (!confirmed) {
            await page.keyboard.press('Escape').catch(() => { });
            log.info(`No second-step confirm (or already unfollowed) for @${handleFromRow}`);
        }

        await page.waitForTimeout(randomBetweenMs(600, 1200));
        return { ok: true, handle: handleFromRow };
    }

    return { ok: false, reason: 'no_eligible_row' };
}

// --- session ---

async function ensureLoggedIn(browser) {
    if (fsSync.existsSync(STORAGE_FILE)) {
        log.info('Loaded saved session');
        return browser.newContext({ storageState: STORAGE_FILE });
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://x.com/login');
    log.info('First run: log in to X in the browser window, then come back here.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question('Press Enter after you are logged in... ', () => { rl.close(); resolve(); }));
    await context.storageState({ path: STORAGE_FILE });
    log.info(`Session saved to ${STORAGE_FILE}. Keep this file private: it grants access to your X session.`);
    await page.close();
    return context;
}

// --- main ---

async function main() {
    log.info(`x-unfollow | daily max: ${DAILY_MAX} (local time)`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));

    const phrase = (await ask('Type UNFOLLOW START to begin: ')).trim();
    if (phrase !== 'UNFOLLOW START') {
        log.info('Aborted.');
        rl.close();
        return;
    }

    const handleInput = (await ask('Your X handle (without @): ')).trim().replace(/^@/, '').toLowerCase();
    if (!handleInput) {
        log.info('Aborted - empty handle.');
        rl.close();
        return;
    }

    let state = await loadDailyState();
    const remainingToday = Math.max(0, DAILY_MAX - state.count);
    if (remainingToday <= 0) {
        log.warn(`Daily limit already reached (${DAILY_MAX}) for ${state.date}. Try tomorrow.`);
        rl.close();
        return;
    }

    const maxRunRaw = (await ask(`Max unfollows this session (default ${SESSION_DEFAULT}, cap ${remainingToday} left today): `)).trim();
    let maxThisRun = maxRunRaw === '' ? SESSION_DEFAULT : parseInt(maxRunRaw, 10);
    if (Number.isNaN(maxThisRun) || maxThisRun < 1) {
        log.info('Aborted - invalid session max.');
        rl.close();
        return;
    }
    maxThisRun = Math.min(maxThisRun, remainingToday, DAILY_MAX);

    rl.close();

    const protectedSet = await loadProtectedHandles();
    if (protectedSet.size > 0) log.info(`Loaded ${protectedSet.size} protected handle(s) from ${PROTECT_FILE}`);

    let browser;
    try {
        browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS);
        const context = await ensureLoggedIn(browser);
        const page = await context.newPage();

        const followingUrl = `https://x.com/${encodeURIComponent(handleInput)}/following`;
        await page.goto(followingUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(randomBetweenMs(4000, 8000));
        await page.waitForSelector('[data-testid="UserCell"]', { timeout: 45000 }).catch(() => {
            log.warn('No user rows yet - check you are logged in and the URL is /following');
        });

        let sessionUnfollows = 0;
        let noProgress = 0;

        log.info(`Running: max ${maxThisRun} this session, ${remainingToday} allowed rest of day before start.`);

        while (!shouldStop && sessionUnfollows < maxThisRun && state.count < DAILY_MAX) {
            if (await handleModals(page)) {
                await page.waitForTimeout(800);
                continue;
            }

            const remaining = DAILY_MAX - state.count;
            if (remaining <= 0) break;

            const res = await unfollowFirstEligibleRow(page, protectedSet, handleInput);
            if (!res.ok) {
                noProgress++;
                await page.evaluate(() => window.scrollBy(0, 900));
                await page.waitForTimeout(randomBetweenMs(2000, 4000));
                if (noProgress > 25) {
                    log.warn('No eligible rows - scroll limit. Refresh or check the page.');
                    break;
                }
                continue;
            }
            noProgress = 0;

            state.count += 1;
            sessionUnfollows += 1;
            await saveDailyState(state);
            log.info(`Unfollowed @${res.handle} | session ${sessionUnfollows}/${maxThisRun} | today ${state.count}/${DAILY_MAX}`);

            if (sessionUnfollows >= maxThisRun || state.count >= DAILY_MAX) break;

            let waitMs = getUnfollowBetweenMs();
            if (sessionUnfollows % 10 === 0) waitMs += getUnfollowBatchRestMs();
            log.info(`Wait ~${Math.round(waitMs / 1000)}s...`);
            let w = 0;
            while (w < waitMs && !shouldStop) {
                await page.waitForTimeout(400);
                w += 400;
            }
        }

        if (shouldStop) log.info('Stopped by Ctrl+C.');
        log.info(`Finished. Today total: ${state.count}/${DAILY_MAX} on ${state.date}`);
    } catch (e) {
        log.error(`Unfollow error: ${e.message}`);
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}

main();
