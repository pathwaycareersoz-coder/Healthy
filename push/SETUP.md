# Background notifications — setup (≈10 minutes, no coding)

This turns the daily reminders into **real push notifications** that arrive even
when the app is closed. Tapping one opens your home-screen app. It uses a tiny
free Cloudflare Worker as the "sender". You only set this up once; everyone you
share the app with then just taps **Turn on background notifications**.

You'll need the two keys:

- **VAPID public key** (safe to share):
  `BGh4usUdWqtdCv0iTzsFI0EkpJQPV6n5me-bTyoYvw72Xj_F0ePOfamqggpSSQL3WplR8zb_cXQPVcMRfB3I2vI`
- **VAPID private key** (secret — keep it private): _provided in chat; never commit it._
- **Subject**: any `mailto:` address, e.g. `mailto:pathwaycareersoz@gmail.com`

> These came pre-generated for you. If you'd rather make your own pair, run
> `npx web-push generate-vapid-keys` and use those instead (update the app's
> `VAPID_PUBLIC_KEY` too).

## A. Dashboard (no CLI)

1. Create a free account at **dash.cloudflare.com**.
2. **Workers & Pages → Create → Workers → Create Worker**. Name it `pdm-push`, click **Deploy**.
3. **Edit code** → delete the sample → paste the entire contents of `push/worker.js` → **Deploy**.
4. **Storage & Databases → KV → Create namespace**, name it `pdm-subs`.
5. Back in the Worker → **Settings → Bindings → Add → KV namespace**:
   - Variable name: `SUBS`
   - KV namespace: `pdm-subs` → **Save**.
6. Worker → **Settings → Variables and Secrets → Add**:
   - `VAPID_PUBLIC_KEY` = the public key above (type: Text)
   - `VAPID_SUBJECT` = `mailto:your@email` (type: Text)
   - `VAPID_PRIVATE_KEY` = the private key from chat (type: **Secret**)
7. Worker → **Settings → Triggers → Cron Triggers → Add** → `*/5 * * * *` → **Add**.
8. Copy the Worker's URL (looks like `https://pdm-push.<your-subdomain>.workers.dev`).

**Send me that URL** and I'll wire it into the app (`PUSH_ENDPOINT` in `index.html`
and `sw.js`) and redeploy — or paste it into both files yourself.

## B. CLI (alternative)

```bash
npm i -g wrangler
cd push
wrangler kv namespace create SUBS      # put the printed id into wrangler.toml
wrangler secret put VAPID_PRIVATE_KEY   # paste the private key
# set VAPID_SUBJECT to your mailto in wrangler.toml [vars]
wrangler deploy
```

## How it works

- The app subscribes your phone to Web Push and sends the Worker your reminder
  times + timezone (never any health data).
- The Worker's cron checks every 5 minutes and sends a push when a reminder is due.
- Your phone's service worker shows the notification; tapping it opens the app.
- iPhone requirement: the app must be **added to the Home Screen** and you must
  **Allow notifications** once (iOS 16.4+).

Nothing sensitive lives here — the Worker only stores push subscriptions,
timezones, and reminder labels.
