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
        el('startBtn').disabled = true;
        el('statusLine').textContent = 'Open your own /following page (x.com/yourhandle/following), then reopen this popup.';
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
    try {
        const res = await send({ type: 'start', sessionMax: el('sessionMax').value.trim() });
        if (!res.ok) {
            el('statusLine').textContent = res.error;
            el('startBtn').disabled = false;
        }
    } catch {
        el('statusLine').textContent = 'Could not reach the page. Reload the tab and try again.';
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

el('saveProtect').addEventListener('click', async () => {
    await chrome.storage.local.set({ protectList: el('protectList').value });
    el('protectCount').textContent = XUnfollowCore.parseProtectList(el('protectList').value).size;
    el('protectSaved').hidden = false;
    setTimeout(() => { el('protectSaved').hidden = true; }, 1500);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.type === 'statusUpdate' && sender.tab && sender.tab.id === activeTabId) {
        renderStatus(msg.status);
    }
});

init();
