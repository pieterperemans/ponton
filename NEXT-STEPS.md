# Picking up Ponton: status as of 24 Nov 2026

## Start here tomorrow (5 minutes)

Open Terminal and run these **one line at a time**. Every new Terminal window starts in your home folder (`~ %`), so the first line is always needed.

```bash
cd "$(find ~ -maxdepth 4 -type d -name ponton 2>/dev/null | head -1)"
```
```bash
git pull
```
```bash
npm install
```
```bash
npm run doctor
```

`npm run doctor` checks your whole setup and prints ✓ (done), ! (attention) or ✗ (blocking), each with the fix. It changes nothing. Fix the ✗ items top to bottom and run it again until there are none. If you're unsure about something, paste its output to Claude.

## Where things stand

| | Item | Status |
|---|---|---|
| ✓ | App: CSV import, categorisation, insights, budgets | Built and tested (sample data) |
| ✓ | PSD2 sync helper + mock bank | Built and tested (mock only) |
| ✓ | HTTPS mode for the helper | Built and tested (mock, self-signed cert) |
| ✓ | Enable Banking account + application registered | Done by you |
| ✓ | `server/private.pem` in place | Done by you. Doctor checks it's in the right folder |
| ? | `server/config.json` with your applicationId | Probably not done yet |
| ✗ | **Redirect URL mismatch**: Enable Banking has `https://localhost:8787/callback`, the helper runs `http` by default | **Decide first thing**, see below |
| ? | Your KBC account linked to the application in the Control Panel | Unknown. Doctor shows "not active" if missing |
| ✗ | First real connection + sync | Not done |
| ✗ | Check KBC's bank data quality (merchant names) | Not done. **This decides whether PSD2 is worth it** |

## The redirect decision (pick one)

- **A (simplest):** in the Enable Banking Control Panel, change the redirect URL to `http://localhost:8787/callback`. Then `config.json` needs no change. If the panel refuses `http`, go for B.
- **B:** keep `https`. Install mkcert and add two lines to `config.json` (steps in `server/README.md` under "Redirect URL with https"). In Ponton → Settings, set the helper address to `https://localhost:8787`.

## Then: first real connection

1. Window 1: `npm run sync`. Leave it running.
2. Window 2 (Cmd+N, then the `cd` line above): `npm run dev`, then open http://localhost:5173.
3. Click **Connect KBC directly** (or Settings → Connect), log in at KBC and choose **personal**.
4. Run `npm run doctor` again. Section 5 should show "Connected" and a last sync time.

## First-sync checks (what we want to learn)

1. **Merchant names:** under Transactions, do card payments show real merchants ("Colruyt Halle") or something generic ("Bancontact payment")? Generic means the categorisation needs adapting to KBC's bank data.
2. **Pending payments:** a card payment from today should show a PENDING badge.
3. **History:** how far back did the first sync go? (Expected: about 90 days.)
4. **Overlap with CSV:** import a KBC CSV covering the same period. The import message should report "already there" and totals should not double.

## Known unknowns
- The Enable Banking request formats and the doctor's online key check (`GET /application`) were written from their API conventions but never called live. Expect possibly one small fix on the first real try.
- KBC credit cards are not available through PSD2.
