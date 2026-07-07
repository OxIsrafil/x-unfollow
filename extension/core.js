// Pure helpers shared by the content script and the unit tests.
// Loaded before content.js (manifest "js" order) so the content script reads
// globalThis.XUnfollowCore; Node tests require() this file directly.

const DAILY_MAX = 600;          // hard ceiling per local calendar day
const SESSION_DEFAULT = 35;     // default unfollows per session

function randomBetweenMs(min, max) {
    return Math.floor(min + Math.random() * (max - min));
}

function getLocalDateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeDailyState(raw, todayKey) {
    if (!raw || raw.date !== todayKey) return { date: todayKey, count: 0 };
    const count = Math.min(DAILY_MAX, Math.max(0, parseInt(raw.count, 10) || 0));
    return { date: todayKey, count };
}

function parseProtectList(text) {
    return new Set(
        String(text || '')
            .split(/\r?\n/)
            .map((l) => l.split('#')[0].trim().replace(/^@/, '').toLowerCase())
            .filter(Boolean)
    );
}

const NON_PROFILE_PATHS = ['i', 'home', 'explore', 'settings', 'messages', 'notifications', 'compose', 'search'];

function handleFromHref(href) {
    const path = String(href || '').split('?')[0];
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1 && !NON_PROFILE_PATHS.includes(parts[0].toLowerCase())) {
        return parts[0];
    }
    return null;
}

function isFollowingLabel(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const lower = t.toLowerCase();
    if (lower === 'following' || /^following\s+@/i.test(t)) return true;
    return false;
}

function clampSessionMax(rawInput, remainingToday) {
    const n = rawInput === '' || rawInput === null || rawInput === undefined
        ? SESSION_DEFAULT
        : parseInt(rawInput, 10);
    if (Number.isNaN(n) || n < 1) return null;
    const clamped = Math.min(n, remainingToday, DAILY_MAX);
    return clamped < 1 ? null : clamped;
}

const XUnfollowCore = {
    DAILY_MAX,
    SESSION_DEFAULT,
    randomBetweenMs,
    getLocalDateKey,
    normalizeDailyState,
    parseProtectList,
    handleFromHref,
    isFollowingLabel,
    clampSessionMax
};

if (typeof module !== 'undefined' && module.exports) module.exports = XUnfollowCore;
if (typeof globalThis !== 'undefined') globalThis.XUnfollowCore = XUnfollowCore;
