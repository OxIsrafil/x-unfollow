# x-unfollow

Bulk-unfollow accounts on X (x.com) from your own following list, at a human pace, in a visible browser window you can watch and stop at any time.

No API keys. No passwords stored. Nothing leaves your machine.

## How it stays safe

- Randomized 20-50 second delay between unfollows, plus a 4-10 minute break every 10 unfollows
- Hard cap of 600 unfollows per day (local time), remembered across runs in `unfollow_daily_state.json`
- A protected-handles list the tool will never unfollow
- You must type `UNFOLLOW START` before anything runs
- Unknown popups are dismissed, never confirmed; unfollow confirmations are only clicked in one explicit, dedicated step
- The browser is always visible: watch it work, press Ctrl+C to stop after the current step

## Setup

Requires Node.js 22.14 or newer.

```bash
git clone https://github.com/OxIsrafil/x-unfollow.git
cd x-unfollow
npm install
npx playwright install chromium
```

## Usage

```bash
npm start
```

1. Type `UNFOLLOW START` to confirm
2. Enter your X handle (without @)
3. Choose how many to unfollow this session (default 35)

On the first run a browser opens at the X login page. Log in, then press Enter in the terminal. Your session is saved to `auth.json` so you only log in once.

## Protecting accounts

Copy the example file and add handles you never want to unfollow:

```bash
cp unfollow_protect_handles.example.txt unfollow_protect_handles.txt
```

One handle per line, with or without @.

## Important

- **Never share `auth.json`.** It contains your X session cookies and grants access to your account. It is gitignored by default.
- Automating actions on X may violate the [X Terms of Service](https://x.com/en/tos) and can lead to rate limits or account restrictions. This tool is intentionally slow and conservative, but no guarantees are made. Use at your own risk.
- This tool only unfollows from your own following list. It cannot post, reply, like, or follow.

## License

[MIT](LICENSE)
