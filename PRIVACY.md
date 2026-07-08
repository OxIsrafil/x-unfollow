# Privacy Policy

x-unfollow unfollows accounts on X from your own following list. It is built so your data never leaves your machine.

## What it collects

Nothing. There is no analytics, no telemetry, no account, and no server. x-unfollow never sends your data anywhere.

## What it stores, and where

The extension keeps a small amount of state in your browser's local storage (`chrome.storage.local`), on your device only:

- Your daily unfollow count and the date, so it can hold the 600-per-day cap across runs.
- Your protected-handles list, so those accounts are never unfollowed.

The command-line tool keeps the same daily count in `unfollow_daily_state.json` and your login session in `auth.json`, both on your own computer. `auth.json` never leaves your machine and is git-ignored.

## Permissions the extension asks for

- `storage` - to save the daily count and protected list above.
- Access to `x.com` - so it can run on your following page and click the unfollow controls for you.

It cannot post, reply, like, follow, or read anything outside the pages you open, and it makes no network requests of its own.

## Third-party services

None. The extension talks only to x.com, inside your own logged-in session, exactly as your browser already does.

## Changes

If this policy ever changes, the update will be committed here in the repository so the history is public.

## Contact

Questions: [@israfill](https://x.com/israfill) on X.
