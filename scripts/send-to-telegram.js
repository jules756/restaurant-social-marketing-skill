#!/usr/bin/env node
/**
 * Push a set of generated slides + caption into the configured Telegram
 * chat using the Bot API directly. Useful for demos where Hermes's agent
 * isn't reliably executing tool calls — this bypasses the agent layer.
 *
 * Usage:
 *   node send-to-telegram.js --config ~/social-marketing/config.json --dir <posts/YYYY-MM-DD-HHmm>
 *   # Or pipe the JSON from demo-post.js:
 *   node demo-post.js --config ... | tail -1 | node send-to-telegram.js --config ... --stdin
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir = getArg('dir');
const useStdin = args.includes('--stdin');

(async () => {
  const config = loadConfig(configPath);
  const token = config.telegram?.botToken;
  const chatId = config.telegram?.chatId;
  if (!token || !chatId) {
    console.error('telegram.botToken and telegram.chatId must be set in config.json');
    process.exit(1);
  }

  let slides = [];
  let caption = '';

  if (useStdin) {
    const raw = fs.readFileSync(0, 'utf-8').trim();
    const last = raw.split('\n').pop();
    const parsed = JSON.parse(last);
    if (!parsed.ok) { console.error('Upstream reported failure:', parsed.error); process.exit(1); }
    slides = parsed.slides;
    caption = parsed.caption;
  } else if (dir) {
    const resolved = path.resolve(dir);
    for (let i = 1; i <= 6; i++) {
      const finalP = path.join(resolved, `slide-${i}.png`);
      const rawP = path.join(resolved, `slide-${i}-raw.png`);
      if (fs.existsSync(finalP)) slides.push(finalP);
      else if (fs.existsSync(rawP)) slides.push(rawP);
    }
    const captionPath = path.join(resolved, 'caption.txt');
    if (fs.existsSync(captionPath)) caption = fs.readFileSync(captionPath, 'utf-8').trim();
  } else {
    console.error('Pass --dir <posts/YYYY-MM-DD-HHmm> or --stdin with demo-post.js output');
    process.exit(1);
  }

  if (slides.length === 0) { console.error('No slides to send'); process.exit(1); }

  const BASE = `https://api.telegram.org/bot${token}`;

  // Send slides as a media group (up to 10 per call). Caption attaches to the first.
  const media = slides.slice(0, 10).map((p, i) => ({
    type: 'photo',
    media: `attach://photo${i}`,
    caption: i === 0 && caption ? caption : undefined
  }));

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('media', JSON.stringify(media));
  for (let i = 0; i < slides.length && i < 10; i++) {
    const buf = fs.readFileSync(slides[i]);
    form.append(`photo${i}`, new Blob([buf], { type: 'image/png' }), `slide-${i + 1}.png`);
  }

  const res = await fetch(`${BASE}/sendMediaGroup`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) {
    console.error('Telegram rejected media group:', data);
    process.exit(1);
  }
  console.log(`✅ Sent ${slides.length} slides to chat ${chatId}`);
})();
