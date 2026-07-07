// x-unfollow content script: the unfollow engine, ported from the CLI
// (unfollow.js). Idles until the popup sends {type:'start'}. The pacing
// waits between unfollows are interruptible via {type:'stop'}; per-row
// action delays (a few seconds) are not. Daily counter and protect list
// live in chrome.storage.local. Unfollow confirmations are only ever
// clicked inside clickUnfollowConfirmation; dismissModals never touches
// them.

const core = globalThis.XUnfollowCore;

console.log('[x-unfollow] content script ready');

let running = false;
let stopRequested = false;
let status = {
    state: 'idle',
    sessionCount: 0,
    sessionMax: 0,
    todayCount: 0,
    message: 'Idle'
};

function setStatus(patch) {
    status = { ...status, ...patch };
    try {
        chrome.runtime.sendMessage({ type: 'statusUpdate', status: publicStatus() }).catch(() => { });
    } catch { }
}

function publicStatus() {
    return { ...status, onFollowingPage: isOnFollowingPage() };
}

function isOnFollowingPage() {
    return /^\/[^/]+\/following\/?$/.test(location.pathname);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Waits in short chunks so a stop request takes effect within ~500 ms.
async function pacedWait(totalMs) {
    let waited = 0;
    while (waited < totalMs && !stopRequested) {
        const chunk = Math.min(500, totalMs - waited);
        await sleep(chunk);
        waited += chunk;
        const left = Math.round((totalMs - waited) / 1000);
        if (left > 0 && left % 5 === 0) setStatus({ message: `Waiting ${left}s` });
    }
}

// --- storage ---

async function loadDailyState() {
    const { dailyState } = await chrome.storage.local.get('dailyState');
    return core.normalizeDailyState(dailyState, core.getLocalDateKey());
}

async function saveDailyState(state) {
    await chrome.storage.local.set({ dailyState: state });
}

async function loadProtectedSet() {
    const { protectList } = await chrome.storage.local.get('protectList');
    return core.parseProtectList(protectList);
}

// --- DOM helpers ---

function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
}

function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

// The CLI drove trusted Playwright input; an extension only has synthetic
// events. Dispatch the full pointer sequence so React's delegated handlers
// fire even where a bare .click() is ignored.
function hardClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
}

// Dismisses interruption dialogs (errors, notices, unknown popups).
// Never touches dialogs mentioning unfollow or delete - those belong to
// clickUnfollowConfirmation or the user.
function dismissModals() {
    for (const dlg of visibleDialogs()) {
        const text = (dlg.innerText || '').slice(0, 700);
        if (/delete post/i.test(text)) continue;
        if (/unfollow/i.test(text)) continue;
        if (!text.trim()) continue;
        const btn =
            dlg.querySelector('[aria-label="Close"]') ||
            [...dlg.querySelectorAll('button,[role="button"]')].find((b) =>
                /^(got it|ok)$/i.test(((b.innerText || '').replace(/\s+/g, ' ').trim()))
            );
        if (btn) {
            hardClick(btn);
            return true;
        }
    }
    return false;
}

// --- unfollow steps (ported from unfollow.js) ---

// Confirm the unfollow sheet after the menu (if X shows a second step).
async function clickUnfollowConfirmation() {
    await sleep(core.randomBetweenMs(450, 900));
    for (let attempt = 0; attempt < 12; attempt++) {
        if (attempt > 0) await sleep(500);

        for (const dlg of visibleDialogs()) {
            if (!/unfollow/i.test((dlg.innerText || '').slice(0, 500))) continue;
            const prim = dlg.querySelector('[data-testid="confirmationSheetConfirmButton"]');
            if (prim) {
                hardClick(prim);
                await sleep(core.randomBetweenMs(400, 800));
                return true;
            }
            for (const b of dlg.querySelectorAll('button,[role="button"]')) {
                const label = (b.innerText || '').replace(/\s+/g, ' ').trim();
                if (/^cancel$/i.test(label)) continue;
                if (/^unfollow$/i.test(label)) {
                    hardClick(b);
                    await sleep(core.randomBetweenMs(400, 800));
                    return true;
                }
            }
        }

        const guardedSheet = [...document.querySelectorAll('[data-testid="confirmationSheetConfirmButton"]')]
            .reverse()
            .find((b) => {
                const dlg = b.closest('[role="dialog"],[role="alertdialog"]');
                return dlg && /unfollow/i.test((dlg.innerText || '').slice(0, 500));
            });
        if (guardedSheet) {
            hardClick(guardedSheet);
            await sleep(core.randomBetweenMs(400, 800));
            return true;
        }
    }

    return false;
}

// Unfollow one account from the visible /following rows. Skips protected
// handles, the page owner, and rows without a Following button.
async function unfollowFirstEligibleRow(protectedSet, myHandleNorm) {
    const cells = [...document.querySelectorAll('[data-testid="UserCell"]')].slice(0, 30);

    for (const cell of cells) {
        let handle = null;
        for (const a of cell.querySelectorAll('a[href^="/"]')) {
            handle = core.handleFromHref(a.getAttribute('href'));
            if (handle) break;
        }
        if (!handle) continue;

        const hNorm = handle.toLowerCase();
        if (hNorm === myHandleNorm) continue;
        if (protectedSet.has(hNorm)) {
            setStatus({ message: `Skipped protected @${handle}` });
            continue;
        }

        const buttons = [...cell.querySelectorAll('[role="button"],button')];
        const followingBtn = buttons.find((b) =>
            core.isFollowingLabel(b.innerText || b.getAttribute('aria-label') || '')
        );
        if (!followingBtn) continue;

        hardClick(followingBtn);
        await sleep(core.randomBetweenMs(500, 1100));

        if (dismissModals()) {
            pressEscape();
            continue;
        }

        let clickedMenu = false;
        for (const mi of document.querySelectorAll('[role="menuitem"]')) {
            const text = (mi.innerText || '').replace(/\s+/g, ' ').trim();
            if (/\bunfollow\b/i.test(text)) {
                hardClick(mi);
                clickedMenu = true;
                break;
            }
        }
        if (!clickedMenu) {
            const directConfirm = visibleDialogs().some(
                (el) => /unfollow/i.test((el.innerText || '').slice(0, 500))
            );
            if (!directConfirm) {
                pressEscape();
                continue;
            }
        }

        await sleep(core.randomBetweenMs(700, 1400));

        if (dismissModals()) {
            pressEscape();
            continue;
        }

        const confirmed = await clickUnfollowConfirmation();
        if (!confirmed) pressEscape();

        await sleep(core.randomBetweenMs(600, 1200));
        return { ok: true, handle };
    }

    return { ok: false };
}

// --- main session loop ---

async function runSession(sessionMax) {
    let sessionCount = 0;

    try {
        let state = await loadDailyState();
        const protectedSet = await loadProtectedSet();
        const myHandleNorm = (location.pathname.split('/')[1] || '').toLowerCase();
        const startPath = location.pathname;
        let noProgress = 0;

        setStatus({
            state: 'running',
            sessionCount,
            sessionMax,
            todayCount: state.count,
            message: 'Running'
        });

        while (!stopRequested && sessionCount < sessionMax && state.count < core.DAILY_MAX) {
            if (location.pathname !== startPath || !isOnFollowingPage()) {
                setStatus({ message: 'Left the following page. Stopped for safety.' });
                break;
            }

            const current = await loadDailyState();
            if (current.count >= core.DAILY_MAX) {
                setStatus({ todayCount: current.count, message: `Daily limit reached (${core.DAILY_MAX}).` });
                break;
            }

            if (dismissModals()) {
                await sleep(800);
                continue;
            }

            const res = await unfollowFirstEligibleRow(protectedSet, myHandleNorm);
            if (!res.ok) {
                noProgress++;
                window.scrollBy(0, 900);
                await sleep(core.randomBetweenMs(2000, 4000));
                if (noProgress > 25) {
                    setStatus({ message: 'No eligible rows found. Refresh the page and start again.' });
                    break;
                }
                continue;
            }
            noProgress = 0;

            const stored = await loadDailyState();
            const base = Math.max(stored.count, state.count);
            state = core.normalizeDailyState(
                { date: stored.date, count: base + 1 },
                core.getLocalDateKey()
            );
            sessionCount++;
            await saveDailyState(state);
            setStatus({
                sessionCount,
                todayCount: state.count,
                message: `Unfollowed @${res.handle}`
            });

            if (sessionCount >= sessionMax || state.count >= core.DAILY_MAX) break;

            let waitMs = core.randomBetweenMs(20000, 50000);
            if (sessionCount % 10 === 0) waitMs += core.randomBetweenMs(240000, 600000);
            setStatus({ message: `Waiting ${Math.round(waitMs / 1000)}s` });
            await pacedWait(waitMs);
        }
    } finally {
        running = false;
        setStatus({
            state: 'idle',
            message: stopRequested ? 'Stopped' : `Finished: ${sessionCount} unfollowed this session`
        });
    }
}

// --- message protocol ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'ping') {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
    }

    if (msg.type === 'status') {
        loadDailyState().then((state) => {
            if (!running) status = { ...status, todayCount: state.count };
            sendResponse(publicStatus());
        }).catch(() => {
            sendResponse({ ...publicStatus() });
        });
        return true;
    }

    if (msg.type === 'start') {
        if (running) {
            sendResponse({ ok: false, error: 'Already running in this tab' });
            return;
        }
        running = true;
        stopRequested = false;
        if (!isOnFollowingPage()) {
            running = false;
            sendResponse({ ok: false, error: 'Open your own /following page first (x.com/yourhandle/following)' });
            return;
        }
        loadDailyState().then((state) => {
            const remaining = Math.max(0, core.DAILY_MAX - state.count);
            if (remaining === 0) {
                running = false;
                sendResponse({ ok: false, error: `Daily limit reached (${core.DAILY_MAX}). Try tomorrow.` });
                return;
            }
            const sessionMax = core.clampSessionMax(msg.sessionMax, remaining);
            if (sessionMax === null) {
                running = false;
                sendResponse({ ok: false, error: 'Session max must be a number of 1 or more' });
                return;
            }
            runSession(sessionMax).catch(() => { });
            sendResponse({ ok: true });
        }).catch(() => {
            running = false;
            sendResponse({ ok: false, error: 'Storage error. Reload the tab and try again.' });
        });
        return true;
    }

    if (msg.type === 'stop') {
        stopRequested = true;
        sendResponse({ ok: true });
        return;
    }
});
