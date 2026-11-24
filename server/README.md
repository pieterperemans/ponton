# Ponton sync helper (PSD2 via Enable Banking)

A small local service, with no dependencies, that keeps Ponton's data current during the month. It holds your Enable Banking private key and talks to the bank API. The web app does all parsing and categorisation. It listens on `127.0.0.1` only and accepts requests only from Ponton's own pages.

## Try it without a bank account

```bash
npm run sync:mock     # fake bank, terminal 1
npm run dev           # terminal 2, then: Settings → Connect
```

## Connect your real KBC account (one-time, about 15 minutes)

1. Create an account at **enablebanking.com** (Control Panel) and register a new **application** for the **Production** environment.
   - Redirect URL: `http://localhost:8787/callback`. If they require HTTPS, see *Redirect URL* below.
   - Let the panel generate the key pair in your browser and download the **private key** (`.pem`).
2. In the Control Panel, **link your own KBC account** to the application. This activates "restricted production" mode: free, for personal use by private individuals, and limited to accounts you link yourself.
3. Save the key as `server/private.pem` and copy `server/config.example.json` to `server/config.json`. Fill in your application id. Both files are git-ignored.
4. Run `npm run sync` and `npm run dev`, then open Ponton and click **Settings → Connect KBC**. You log in at KBC, choose **personal**, and come back to Ponton, which syncs straight away.

After that, Ponton syncs automatically whenever you open it and the last sync is more than 30 minutes old. Use `npm run sync:background` to also refresh every 6 hours while the helper runs. That is 4 times a day, which is the PSD2 limit for access while you're not present.

## Things to know

- **Consent expires** after the period KBC allows: up to 180 days. I believe EU rules moved from 90 to 180 days in 2023, but I haven't verified this for KBC. Ponton warns you 14 days ahead, and renewing is one KBC login.
- **KBC credit cards are not available through PSD2.** Your current account and debit card payments are.
- **History:** the first sync fetches the last 90 days. Keep using CSV import for older history. Overlapping CSV and bank data is de-duplicated (same account and amount, dates within 4 days).
- **Pending payments** (e.g. a card payment from this morning) count towards your budgets straight away. They are replaced by the booked version on a later sync. If you change a pending payment's category by hand, the change carries over.
- **Redirect URL:** if Enable Banking rejects `http://localhost`, register an HTTPS URL you control that forwards to `http://localhost:8787/callback`, and set `redirectUrl` in `config.json` to that HTTPS URL. *Not yet verified against their current rules.*
- **Data at rest:** `server/data/state.json` holds the session id and the last ~90 days of raw transactions, readable only by your user (file mode 600). Delete the folder to forget everything.

## Unverified

The Enable Banking request and response formats (`/auth`, `/sessions`, `/accounts/{uid}/transactions`, JWT claims) were written from their published API conventions. I couldn't call the live API while building this, so the first real connection is the test. If something fails, the error from Enable Banking is shown in Ponton's Settings and in the helper's response.
