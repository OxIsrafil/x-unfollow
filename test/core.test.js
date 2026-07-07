import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../extension/core.js');

test('getLocalDateKey formats as YYYY-MM-DD with zero padding', () => {
    assert.equal(core.getLocalDateKey(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(core.getLocalDateKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('normalizeDailyState resets on a new day', () => {
    assert.deepEqual(
        core.normalizeDailyState({ date: '2026-01-04', count: 50 }, '2026-01-05'),
        { date: '2026-01-05', count: 0 }
    );
});

test('normalizeDailyState keeps same-day count, clamps to cap, survives junk', () => {
    assert.deepEqual(
        core.normalizeDailyState({ date: '2026-01-05', count: 41 }, '2026-01-05'),
        { date: '2026-01-05', count: 41 }
    );
    assert.deepEqual(
        core.normalizeDailyState({ date: '2026-01-05', count: 9999 }, '2026-01-05'),
        { date: '2026-01-05', count: 600 }
    );
    assert.deepEqual(
        core.normalizeDailyState(null, '2026-01-05'),
        { date: '2026-01-05', count: 0 }
    );
    assert.deepEqual(
        core.normalizeDailyState({ date: '2026-01-05', count: 'abc' }, '2026-01-05'),
        { date: '2026-01-05', count: 0 }
    );
});

test('parseProtectList strips @, comments, whitespace, case', () => {
    const set = core.parseProtectList('@Alice\nbob # my friend\n# full comment line\n\n  @CaRl  ');
    assert.deepEqual([...set].sort(), ['alice', 'bob', 'carl']);
    assert.equal(core.parseProtectList('').size, 0);
    assert.equal(core.parseProtectList(null).size, 0);
});

test('handleFromHref extracts profile handles only', () => {
    assert.equal(core.handleFromHref('/somebody'), 'somebody');
    assert.equal(core.handleFromHref('/somebody?src=whatever'), 'somebody');
    assert.equal(core.handleFromHref('/i/lists/123'), null);
    assert.equal(core.handleFromHref('/settings'), null);
    assert.equal(core.handleFromHref('/Home'), null);
    assert.equal(core.handleFromHref('/alice/status/123'), null);
    assert.equal(core.handleFromHref(''), null);
});

test('isFollowingLabel matches Following buttons, never Unfollow or Follow', () => {
    assert.equal(core.isFollowingLabel('Following'), true);
    assert.equal(core.isFollowingLabel('  following '), true);
    assert.equal(core.isFollowingLabel('Following @alice'), true);
    assert.equal(core.isFollowingLabel('Follow'), false);
    assert.equal(core.isFollowingLabel('Unfollow'), false);
    assert.equal(core.isFollowingLabel('Unfollow @alice'), false);
    assert.equal(core.isFollowingLabel(''), false);
});

test('clampSessionMax defaults on empty, rejects junk, clamps to remaining', () => {
    assert.equal(core.clampSessionMax('', 600), 35);
    assert.equal(core.clampSessionMax(null, 600), 35);
    assert.equal(core.clampSessionMax('50', 20), 20);
    assert.equal(core.clampSessionMax('10', 600), 10);
    assert.equal(core.clampSessionMax('abc', 600), null);
    assert.equal(core.clampSessionMax('0', 600), null);
    assert.equal(core.clampSessionMax('-5', 600), null);
});

test('randomBetweenMs stays within bounds', () => {
    for (let i = 0; i < 200; i++) {
        const v = core.randomBetweenMs(100, 200);
        assert.ok(v >= 100 && v < 200, `out of range: ${v}`);
    }
});
