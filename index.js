// crypto-breaking-alerts: crypto news RSS feeds -> AI impact filter -> ntfy push
// Separate from crypto-news-bot (which covers macro economic calendar events).
// This one watches for sudden, wick-causing crypto news: hacks, regulatory bombshells,
// exchange collapses, major exploits, etc. Runs every 30 min via GitHub Actions.
//
// Pulls directly from major outlets' own RSS feeds (not a third-party aggregator API) —
// these are free, stable, and not subject to a random paywall/rate-limit change.

import fs from "node:fs";
import Parser from "rss-parser";

const RSS_FEEDS = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml" },
  { source: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
  { source: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed" },
];

const STATE_FILE = "state.json";
const STATE_RETENTION_HOURS = 24 * 7; // keep seen-article IDs for 7 days, then prune

// Only consider articles published within this many hours — keeps the first run (and any run
// after downtime) from suddenly processing a huge backlog through the AI all at once.
const RECENCY_WINDOW_HOURS = 3;

const NTFY_TOPIC = process.env.NTFY_TOPIC; // use a DIFFERENT topic name than the macro bot
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const parser = new Parser();

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { seen: parsed.seen || {} };
  } catch {
    return { seen: {} }; // first run, or file missing/corrupt — start fresh
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function pruneState(state) {
  const cutoff = Date.now() - STATE_RETENTION_HOURS * 60 * 60 * 1000;
  for (const [id, seenAt] of Object.entries(state.seen)) {
    if (new Date(seenAt).getTime() < cutoff) delete state.seen[id];
  }
}

async function fetchAllFeeds() {
  const results = [];
  for (const { source, url } of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        results.push({
          title: item.title || "(untitled)",
          link: item.link || item.guid || "",
          description: item.contentSnippet || item.content || "",
          pubDate: item.isoDate || item.pubDate || null,
          source,
        });
      }
    } catch (err) {
      // One dead/slow feed shouldn't take down the whole run — log and move on.
      console.error(`Failed to fetch/parse feed for ${source} (${url}):`, err.message);
    }
  }
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifyImpact(article) {
  const prompt = `You are a crypto market analyst filtering breaking news for genuine, sudden
market-moving significance. Decide if this news could cause a SUDDEN, sharp price move in
BTC/crypto right now — a flash crash, violent pump, liquidation cascade, hack, exploit, major
regulatory shock, exchange collapse/insolvency, or similar shock event. Routine price commentary,
opinion pieces, minor partnership announcements, and generic market recaps are LOW, not HIGH.

Respond in EXACTLY this format, nothing else:
VERDICT: HIGH or LOW
REASON: one or two short sentences — why, and the likely directional impact if HIGH

Headline: ${article.title}
Description: ${article.description || "N/A"}
Source: ${article.source || "Unknown"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    console.error("Gemini API did not return text. Raw response:", JSON.stringify(data));
    return { verdict: "LOW", reason: "AI analysis unavailable for this article." };
  }

  const verdictMatch = text.match(/VERDICT:\s*(HIGH|LOW)/i);
  const reasonMatch = text.match(/REASON:\s*([\s\S]*)/i);
  return {
    verdict: verdictMatch ? verdictMatch[1].toUpperCase() : "LOW",
    reason: reasonMatch ? reasonMatch[1].trim() : text,
  };
}

function toAsciiSafeHeader(str) {
  // HTTP headers must be plain ASCII (ByteString). Strip anything outside that range
  // so unexpected characters from a feed can never crash the request.
  return String(str).replace(/[^\x00-\xFF]/g, "");
}

async function sendNtfyMessage({ title, message, priority, tags }) {
  const url = `https://ntfy.sh/${NTFY_TOPIC}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Title: toAsciiSafeHeader(title),
      Priority: String(priority),
      Tags: toAsciiSafeHeader(tags),
    },
    body: message, // body can safely contain emoji / any UTF-8 text
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ntfy send failed: ${err}`);
  }
}

async function main() {
  if (!NTFY_TOPIC || !GEMINI_API_KEY) {
    throw new Error("Missing env vars. Need NTFY_TOPIC, GEMINI_API_KEY.");
  }

  const state = loadState();
  pruneState(state);

  const articles = await fetchAllFeeds();
  const cutoff = Date.now() - RECENCY_WINDOW_HOURS * 60 * 60 * 1000;
  const recent = articles.filter((a) => a.pubDate && new Date(a.pubDate).getTime() >= cutoff);
  const unseen = recent.filter((a) => a.link && !state.seen[a.link]);

  console.log(
    `Fetched ${articles.length} total article(s) across ${RSS_FEEDS.length} feeds, ${recent.length} within the last ${RECENCY_WINDOW_HOURS}h, ${unseen.length} not yet processed.`
  );

  let alertCount = 0;

  for (const article of unseen) {
    await sleep(4000); // ~15 calls/min max — comfortably under the free tier's per-minute limit
    const { verdict, reason } = await classifyImpact(article);

    if (verdict === "HIGH") {
      const title = `BREAKING: ${article.title}`;
      const message = `🔴 ${article.source}\n\n${reason}\n\n${article.link}`;
      await sendNtfyMessage({
        title,
        message,
        priority: 5, // urgent — cuts through, sound/vibrate even on silent
        tags: "rotating_light,warning",
      });
      alertCount++;
    }

    // Mark as seen either way (HIGH or LOW) so we never re-classify or re-notify the same article.
    state.seen[article.link] = article.pubDate || new Date().toISOString();
    saveState(state); // save immediately so progress isn't lost if a later item fails
  }

  console.log(`Sent ${alertCount} HIGH-impact alert(s) via ntfy.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
