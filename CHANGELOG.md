# Changelog

All notable changes to x-unfollow are documented here. This project follows [semantic versioning](https://semver.org).

## 1.3.0 - 2026-07-09

- Live time estimate while a run is going, alongside a "3 of 20" session count under the progress bar
- A quick confirm step before a large run (over 100 at once), so a big number is never a slip
- A brief success toast when a session finishes, showing how many you unfollowed

## 1.2.0 - 2026-07-09

- Redesigned popup with a premium, animated feel: an on-brand aurora accent, a staggered entrance, and a live progress bar with a pulse while a run is going
- The session size you enter is now remembered when you close and reopen the popup
- Fixed the Stop button being visible while idle

## 1.1.0 - 2026-07-09

- One-click **Protect** buttons on your following page - whitelist anyone without typing handles
- Redesigned popup to match the landing page: X-badge mark, blue accent, rounded controls, a count badge, and full dark mode
- Protected list now saves automatically as you type; no Save button to forget
- Added a privacy policy

## 1.0.0 - Initial release

- Paced bulk unfollow from your own following list, inside your own logged-in browser
- Randomized 20-50 second delay between unfollows, with a longer break every 10
- Hard cap of 600 unfollows per day, remembered across runs
- Protected-handles list that is never unfollowed
- Popup with Start/Stop and a live daily counter
- Companion command-line tool for the same engine
