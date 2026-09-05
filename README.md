# Crypto Breaking Alerts (Personal Use)

A separate bot from your economic-calendar one. This one watches for sudden, high-impact
crypto-specific news — hacks, exploits, regulatory bombshells, exchange collapses — the kind of
thing that causes sharp price wicks. It filters everything through AI first and only pushes a
notification for genuinely HIGH-impact stories, not routine market chatter.

## What it does
1. Checks a free, no-key-needed crypto news feed every 30 minutes for new breaking headlines.
2. Sends each new headline to Gemini, asking: "could this cause a sudden price move?"
3. Only pushes a notification for headlines the AI rates HIGH impact.
4. Remembers which articles it already checked (via `state.json`) so nothing repeats.

## Setup (10 minutes — quicker since you've done this once already)

### 1. Create a NEW ntfy topic (separate from your other bot)
1. Open the ntfy app (already installed from before).
2. Tap **+** → Subscribe to topic.
3. Pick a **different** random name than your macro bot's topic — e.g. `tharu-crypto-breaking-9x2k`.
4. Subscribe. This keeps the two bots' notifications visually distinct on your phone.

### 2. Reuse your Gemini API key
Same key from aistudio.google.com/apikey works fine — no need to make a new one. You'll just
add it as a secret in this new repo too (secrets don't carry over between repos).

### 3. Create a new GitHub repo
1. github.com → "+" → New repository → name it e.g. `crypto-breaking-alerts` → Private → Create.
2. Upload these files, keeping the folder structure exactly as-is:
   - `index.js`
   - `package.json`
   - `README.md`
   - `.github/workflows/breaking-run.yml`

### 4. Add your secrets
Settings → Secrets and variables → Actions → New repository secret. Add both:
- `NTFY_TOPIC` — the **new** topic name from step 1 (e.g. `tharu-crypto-breaking-9x2k`)
- `GEMINI_API_KEY` — same key as your other bot

### 5. Test it
Actions tab → "Crypto Breaking Alerts" → Run workflow. Check the log — it'll say how many
articles it checked and how many were HIGH impact. You'll only get a phone notification if
something genuinely urgent was found in the last 2 hours of news, which may not happen every run.

It then runs automatically every 30 minutes from here.

## Customizing
- Check frequency — edit the `cron` line in `.github/workflows/breaking-run.yml`. Every 30 min
  uses roughly 1,440 GitHub Actions minutes/month, well inside the 2,000/month free tier.
- Sensitivity — edit the wording of the `classifyImpact()` prompt in `index.js` if it's alerting
  too often or too rarely. You can also ask it to only flag EXTREME events by tightening the
  prompt's examples.
- Language — add "Respond with REASON in Sinhala-English mix" to the prompt if you want that.

## Notes
- 100% free: GitHub Actions free tier, the news feed (cryptocurrency.cv, no key needed), Gemini
  free tier, ntfy free.
- **GitHub Actions minutes are shared across your whole account, not per-repo.** This bot (every
  30 min, ~1,440 min/month) plus your macro-calendar bot (every 3h, ~240 min/month) together use
  about 1,680 of your 2,000 free minutes/month — safe, but not a lot of spare room. If you want
  more headroom with zero downside, you can switch either repo's visibility to **Public** in
  Settings → General — public repos get unlimited free Actions minutes, and your secrets (API
  keys) stay just as hidden either way.
- The script waits 4 seconds between each Gemini call to stay safely under the free tier's
  per-minute request limit, even if a burst of many new articles shows up in one check.
- This bot is intentionally separate from your macro-calendar bot (`crypto-news-bot`) so the two
  alert types stay distinguishable — economic data surprises vs sudden crypto-specific shocks.
- If Gemini ever starts failing, check the Actions log the same way as before — the real error
  (and the current model name to switch to, if retired again) will show there.
