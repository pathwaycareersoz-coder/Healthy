/**
 * Pain Driven Man — push sender (Cloudflare Worker)
 * ------------------------------------------------------------------
 * A tiny scheduler that sends the daily reminders as real Web Push
 * notifications, even when the app is closed. Tapping one opens the
 * installed home-screen app.
 *
 * It needs:
 *   - a KV namespace bound as   SUBS
 *   - a Cron Trigger            (every 5 minutes:  *\/5 * * * *)
 *   - three variables:
 *       VAPID_PUBLIC_KEY   (public — same one embedded in the app)
 *       VAPID_PRIVATE_KEY  (secret — never commit this)
 *       VAPID_SUBJECT      (e.g. mailto:you@example.com)
 *
 * See push/SETUP.md for click-by-click dashboard steps.
 * No payload encryption is used: pushes are "empty", and the service
 * worker fetches the due reminder text from /due. Simple + robust.
 */

const WINDOW = 5; // minutes; must match the cron interval
// deploy trigger: 1

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    try {
      if (url.pathname === "/config") {
        return cors(json({ vapidPublicKey: env.VAPID_PUBLIC_KEY || "" }));
      }
      if (url.pathname === "/subscribe" && request.method === "POST") {
        const body = await request.json();
        const sub = body.subscription;
        if (!sub || !sub.endpoint) return cors(json({ error: "no subscription" }, 400));
        const hash = await sha256hex(sub.endpoint);
        await env.SUBS.put("sub:" + hash, JSON.stringify({
          hash,
          subscription: sub,
          tz: body.tz || "UTC",
          name: body.name || "",
          reminders: Array.isArray(body.reminders) ? body.reminders : [],
          updatedAt: Date.now(),
        }));
        return cors(json({ ok: true }));
      }
      if (url.pathname === "/unsubscribe" && request.method === "POST") {
        const body = await request.json();
        const ep = body.endpoint;
        if (ep) await env.SUBS.delete("sub:" + (await sha256hex(ep)));
        return cors(json({ ok: true }));
      }
      if (url.pathname === "/due" && request.method === "POST") {
        const body = await request.json();
        const ep = body.endpoint || "";
        const hash = await sha256hex(ep);
        const pend = await env.SUBS.get("pending:" + hash);
        if (pend) {
          await env.SUBS.delete("pending:" + hash);
          return cors(new Response(pend, { headers: { "content-type": "application/json" } }));
        }
        return cors(json({ title: "Pain Driven Man", body: "Time for your next check-in." }));
      }
      if (url.pathname === "/" || url.pathname === "/health") {
        return cors(json({ ok: true, service: "pdm-push" }));
      }
      return cors(json({ error: "not found" }, 404));
    } catch (e) {
      return cors(json({ error: String(e && e.message || e) }, 500));
    }
  },

  // Runs on the Cron Trigger.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

async function runReminders(env) {
  const list = await env.SUBS.list({ prefix: "sub:" });
  for (const key of list.keys) {
    const raw = await env.SUBS.get(key.name);
    if (!raw) continue;
    let rec;
    try { rec = JSON.parse(raw); } catch { continue; }
    const cur = hm2min(localHHMM(rec.tz || "UTC"));
    // reminders whose time falls in (cur-WINDOW, cur]; take the last one
    const due = (rec.reminders || [])
      .filter((r) => { const t = hm2min(r.hhmm); return t > cur - WINDOW && t <= cur; })
      .pop();
    if (!due) continue;
    await env.SUBS.put("pending:" + rec.hash,
      JSON.stringify({ title: due.label || "Pain Driven Man", body: due.body || "" }),
      { expirationTtl: 900 });
    const status = await sendPush(rec.subscription, env);
    if (status === 404 || status === 410) {
      await env.SUBS.delete(key.name);
      await env.SUBS.delete("pending:" + rec.hash);
    }
  }
}

/* ---------- Web Push (VAPID, payload-less) ---------- */
async function sendPush(subscription, env) {
  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJWT(aud, env);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "300",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Length": "0",
    },
  });
  return res.status;
}

async function vapidJWT(aud, env) {
  const header = { alg: "ES256", typ: "JWT" };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" };
  const signingInput = b64url(strToBuf(JSON.stringify(header))) + "." + b64url(strToBuf(JSON.stringify(payload)));
  const key = await importVapidKey(env);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, strToBuf(signingInput));
  return signingInput + "." + b64url(sig);
}

async function importVapidKey(env) {
  const pub = b64urlToBuf(env.VAPID_PUBLIC_KEY); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = b64url(pub.slice(1, 33));
  const y = b64url(pub.slice(33, 65));
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE_KEY, x, y, ext: true, key_ops: ["sign"] };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/* ---------- helpers ---------- */
function localHHMM(tz) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour").value;
  const m = parts.find((p) => p.type === "minute").value;
  return (h === "24" ? "00" : h) + ":" + m;
}
function hm2min(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }
function strToBuf(s) { return new TextEncoder().encode(s); }
function b64url(buf) {
  const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", strToBuf(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "content-type");
  return new Response(res.body, { status: res.status, headers: h });
}
