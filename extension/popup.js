// Popup controller: talks to the content script in the active tab.
// The engine runs in the page, so closing this popup does not stop it.

const el = (id) => document.getElementById(id);

let activeTabId = null;

function showNotice(text) {
    el('notice').textContent = text;
    el('notice').hidden = false;
    el('controls').hidden = true;
}

// Count the "Today" number up to its new value, unless reduced-motion is set.
let lastToday = null;
function setToday(n) {
    const t = el('today');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (lastToday === null || reduce || n === lastToday) {
        t.textContent = `Today: ${n}/600`;
        lastToday = n;
        return;
    }
    const from = lastToday, start = performance.now(), dur = 500;
    lastToday = n;
    (function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        t.textContent = `Today: ${Math.round(from + (n - from) * eased)}/600`;
        if (p < 1) requestAnimationFrame(tick);
    })(start);
}

// Rough time-remaining estimate for a run: ~35s between unfollows plus a long
// break (~7 min) after every 10. Deliberately approximate, so it is labelled "~".
function etaMinutes(remaining) {
    const secs = remaining * 35 + Math.floor(remaining / 10) * 420;
    return Math.max(1, Math.round(secs / 60)) + ' min';
}

// Brief success toast when a session finishes. prevState lets us fire it once,
// on the running -> idle transition, rather than on every idle status.
let prevState = null;
let successTimer = null;
function showSuccess(n) {
    const box = el('success'), txt = el('successText');
    if (!box || !txt) return;
    txt.textContent = `Unfollowed ${n} this session`;
    box.hidden = false;
    clearTimeout(successTimer);
    successTimer = setTimeout(() => { box.hidden = true; }, 4200);
}

function renderStatus(s) {
    setToday(s.todayCount);
    el('statusLine').textContent = s.message;
    const runningHere = s.state === 'running';
    const confirming = el('confirmBar') && !el('confirmBar').hidden;
    el('startBtn').hidden = runningHere || confirming;
    el('stopBtn').hidden = !runningHere;
    el('controls').classList.toggle('running', runningHere);
    const fill = el('sessionProgressFill');
    if (fill) {
        const pct = runningHere && s.sessionMax ? Math.min(100, Math.round((s.sessionCount / s.sessionMax) * 100)) : 0;
        fill.style.width = pct + '%';
    }
    const runCountEl = el('runCount'), etaEl = el('eta');
    if (runningHere && runCountEl && etaEl) {
        const total = s.sessionMax || 0, done = s.sessionCount || 0;
        runCountEl.textContent = total ? `${done} of ${total}` : `${done}`;
        const remaining = Math.max(0, total - done);
        etaEl.textContent = remaining ? `~${etaMinutes(remaining)} left` : 'almost done';
    }
    if (prevState === 'running' && !runningHere && (s.sessionCount || 0) > 0) {
        showSuccess(s.sessionCount);
    }
    prevState = s.state;
    if (!runningHere && !s.onFollowingPage) {
        el('startBtn').disabled = false;
        el('statusLine').textContent = 'Press Start to jump to your following page and begin.';
    } else if (!runningHere) {
        el('startBtn').disabled = false;
    }
}

async function send(msg) {
    return chrome.tabs.sendMessage(activeTabId, msg);
}

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab && tab.id;

    let status = null;
    try {
        status = await send({ type: 'status' });
    } catch {
        showNotice('Could not reach this page. If you are on x.com, reload the tab once (needed after installing), then reopen this popup. Otherwise go to x.com and open your /following page.');
    }
    if (status) renderStatus(status);

    const { protectList, sessionMax } = await chrome.storage.local.get(['protectList', 'sessionMax']);
    el('protectList').value = protectList || '';
    el('protectCount').textContent = XUnfollowCore.parseProtectList(protectList || '').size;
    if (sessionMax) el('sessionMax').value = sessionMax;
}

async function beginStart() {
    el('startBtn').disabled = true;
    const sessionMax = el('sessionMax').value.trim();
    try {
        const status = await send({ type: 'status' });
        if (status && status.onFollowingPage) {
            const res = await send({ type: 'start', sessionMax });
            if (!res.ok) {
                el('statusLine').textContent = res.error;
                el('startBtn').hidden = false;
                el('startBtn').disabled = false;
            }
            return;
        }
        const { handle } = await send({ type: 'resolveHandle' });
        if (!handle) {
            el('statusLine').textContent = 'Could not detect your handle. Open x.com/yourhandle/following and press Start.';
            el('startBtn').hidden = false;
            el('startBtn').disabled = false;
            return;
        }
        await chrome.storage.local.set({ autoStart: { ts: Date.now(), handle, sessionMax } });
        el('statusLine').textContent = 'Opening your following page...';
        await chrome.tabs.update(activeTabId, { url: `https://x.com/${handle}/following` });
        window.close();
    } catch {
        el('statusLine').textContent = 'Could not reach the page. If you are on x.com, reload the tab, then try again. Otherwise open x.com first.';
        el('startBtn').hidden = false;
        el('startBtn').disabled = false;
    }
}

// A big run (over 100 at once) gets one inline confirm before it begins.
el('startBtn').addEventListener('click', () => {
    const n = parseInt(el('sessionMax').value.trim(), 10);
    const confirmBar = el('confirmBar');
    if (confirmBar && Number.isFinite(n) && n > 100) {
        el('confirmText').textContent = `Unfollow up to ${n} accounts this session? That is a lot to do at once.`;
        el('startBtn').hidden = true;
        confirmBar.hidden = false;
        return;
    }
    beginStart();
});

const confirmYes = el('confirmYes'), confirmNo = el('confirmNo');
if (confirmYes) confirmYes.addEventListener('click', () => {
    el('confirmBar').hidden = true;
    beginStart();
});
if (confirmNo) confirmNo.addEventListener('click', () => {
    el('confirmBar').hidden = true;
    el('startBtn').hidden = false;
});

el('stopBtn').addEventListener('click', async () => {
    try {
        await send({ type: 'stop' });
        el('statusLine').textContent = 'Stopping after the current step...';
    } catch {
        el('statusLine').textContent = 'Could not reach the page. It may have been closed.';
    }
});

// Autosave the protected list as you type (debounced), so nothing is lost if
// you close the popup. It lives in chrome.storage.local and stays until you
// edit it here - closing the popup, or Chrome, never clears it.
let protectSaveTimer = null;
el('protectList').addEventListener('input', () => {
    el('protectCount').textContent = XUnfollowCore.parseProtectList(el('protectList').value).size;
    el('protectSaved').hidden = true;
    clearTimeout(protectSaveTimer);
    protectSaveTimer = setTimeout(async () => {
        await chrome.storage.local.set({ protectList: el('protectList').value });
        el('protectSaved').hidden = false;
    }, 400);
});

// Remember the session-max value across popup open/close.
el('sessionMax').addEventListener('input', () => {
    chrome.storage.local.set({ sessionMax: el('sessionMax').value });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'statusUpdate' && sender.tab && sender.tab.id === activeTabId) {
        renderStatus(msg.status);
    }
});

init();
