// Popup controller: talks to the content script in the active tab.
// The engine runs in the page, so closing this popup does not stop it.

const el = (id) => document.getElementById(id);

let activeTabId = null;

function showNotice(text) {
    el('notice').textContent = text;
    el('notice').hidden = false;
    el('controls').hidden = true;
}

function renderStatus(s) {
    el('today').textContent = `Today: ${s.todayCount}/600`;
    el('statusLine').textContent = s.message;
    const runningHere = s.state === 'running';
    el('startBtn').hidden = runningHere;
    el('stopBtn').hidden = !runningHere;
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

    const { protectList } = await chrome.storage.local.get('protectList');
    el('protectList').value = protectList || '';
    el('protectCount').textContent = XUnfollowCore.parseProtectList(protectList || '').size;
}

el('startBtn').addEventListener('click', async () => {
    el('startBtn').disabled = true;
    const sessionMax = el('sessionMax').value.trim();
    try {
        const status = await send({ type: 'status' });
        if (status && status.onFollowingPage) {
            const res = await send({ type: 'start', sessionMax });
            if (!res.ok) {
                el('statusLine').textContent = res.error;
                el('startBtn').disabled = false;
            }
            return;
        }
        const { handle } = await send({ type: 'resolveHandle' });
        if (!handle) {
            el('statusLine').textContent = 'Could not detect your handle. Open x.com/yourhandle/following and press Start.';
            el('startBtn').disabled = false;
            return;
        }
        await chrome.storage.local.set({ autoStart: { ts: Date.now(), handle, sessionMax } });
        el('statusLine').textContent = 'Opening your following page...';
        await chrome.tabs.update(activeTabId, { url: `https://x.com/${handle}/following` });
        window.close();
    } catch {
        el('statusLine').textContent = 'Could not reach the page. If you are on x.com, reload the tab, then try again. Otherwise open x.com first.';
        el('startBtn').disabled = false;
    }
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

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'statusUpdate' && sender.tab && sender.tab.id === activeTabId) {
        renderStatus(msg.status);
    }
});

init();
