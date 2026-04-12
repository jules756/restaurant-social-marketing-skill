#!/usr/bin/env node
/**
 * Promotion Manager (Restaurant Marketing)
 *
 * Manages restaurant promotions: creation, tracking, content planning,
 * and performance reporting. Integrates with hook-performance.json to
 * attribute post performance to specific promotions.
 *
 * Usage:
 *   node promotion-manager.js --init --dir <path>
 *   node promotion-manager.js --add --dir <path> --data '<json>'
 *   node promotion-manager.js --list --dir <path>
 *   node promotion-manager.js --active --dir <path>
 *   node promotion-manager.js --upcoming --dir <path>
 *   node promotion-manager.js --end --dir <path> --id <promotion-id>
 *   node promotion-manager.js --content-plan --dir <path> --id <promotion-id>
 *   node promotion-manager.js --check-expiring --dir <path>
 *   node promotion-manager.js --report --dir <path> --id <promotion-id>
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const dir = getArg('dir');
if (!dir) {
  console.error('Usage: node promotion-manager.js <command> --dir <path> [options]');
  console.error('\nCommands: --init, --add, --list, --active, --upcoming, --end, --content-plan, --check-expiring, --report');
  process.exit(1);
}
const promotionsPath = path.join(dir, 'promotions.json');

// ==========================================
// Helpers
// ==========================================
function today() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString(); }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function fmtDate(d) { return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; }
function slugify(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function computeStatus(startDate, endDate) {
  const t = parseDate(today()), s = parseDate(startDate), e = parseDate(endDate);
  if (t < s) return 'upcoming';
  if (t > e) return 'ended';
  return 'active';
}
function loadPromotions() {
  if (!fs.existsSync(promotionsPath)) {
    console.error(`Error: ${promotionsPath} not found. Run --init first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(promotionsPath, 'utf-8'));
}
function savePromotions(data) { fs.writeFileSync(promotionsPath, JSON.stringify(data, null, 2)); }
function findPromotion(data, id) {
  const p = data.promotions.find(p => p.id === id);
  if (!p) { console.error(`Error: Promotion "${id}" not found.`); process.exit(1); }
  return p;
}
function refreshStatuses(data) {
  let changed = false;
  for (const p of data.promotions) {
    if (p.status === 'ended-early') continue;
    const s = computeStatus(p.startDate, p.endDate);
    if (p.status !== s) { p.status = s; changed = true; }
  }
  return changed;
}
function offerStr(p) {
  return p.discount ? `${p.discount} off${p.items.length > 0 ? ' ' + p.items.join(', ') : ''}` : '';
}
function planTotal(plan) {
  return (plan.teaserPosts||0) + (plan.launchPosts||0) + (plan.midPromoPosts||0)
    + (plan.reminderPosts||0) + (plan.lastChancePosts||0) + (plan.wrapUpPosts||0);
}
function countTypes(entries) {
  const types = entries.map(e => e.type);
  return {
    teaserPosts: types.filter(t => t === 'TEASER').length,
    launchPosts: types.filter(t => t === 'LAUNCH').length,
    midPromoPosts: types.filter(t => t === 'MID-PROMO').length,
    reminderPosts: types.filter(t => t === 'REMINDER').length,
    lastChancePosts: types.filter(t => t === 'LAST CHANCE').length,
    wrapUpPosts: types.filter(t => t === 'WRAP-UP').length
  };
}

function buildContentPlan(promo) {
  const start = parseDate(promo.startDate), end = parseDate(promo.endDate);
  const dur = daysBetween(start, end);
  const items = promo.items || [], disc = promo.discount || '', name = promo.name;
  const item0 = items.length > 0 ? items[0].toLowerCase() : 'selected items';
  const addDay = (base, n) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
  const plan = [];
  plan.push({ day: -2, date: addDay(start, -2), type: 'TEASER', suggestion: '"Something special is coming to [Restaurant]..."' });
  plan.push({ day: -1, date: addDay(start, -1), type: 'TEASER', suggestion: `"Tomorrow. ${name}. You're not ready for this."` });
  plan.push({ day: 0, date: promo.startDate, type: 'LAUNCH', suggestion: `"${disc} off all ${item0} this week at [Restaurant]"` });
  if (items.length > 1) {
    plan.push({ day: 0, date: promo.startDate, type: 'LAUNCH', suggestion: `"${items[1]} is ${disc} off and it's incredible"` });
  }
  if (dur >= 3) {
    const mid = Math.floor(dur / 2);
    plan.push({ day: mid, date: addDay(start, mid), type: 'MID-PROMO', suggestion: `"Everyone's been ordering the ${item0} this week"` });
  }
  if (dur >= 4) {
    const rem = dur - 2;
    plan.push({ day: rem, date: addDay(start, rem), type: 'REMINDER', suggestion: `"Only 2 days left for ${name.toLowerCase()}"` });
  }
  plan.push({ day: dur, date: promo.endDate, type: 'LAST CHANCE', suggestion: `"Last night for ${disc} off ${item0} at [Restaurant]"` });
  plan.push({ day: dur + 1, date: addDay(end, 1), type: 'WRAP-UP', suggestion: `"${name} was amazing -- here's what happened"` });
  return plan;
}

// ==========================================
// Commands
// ==========================================
function cmdInit() {
  if (fs.existsSync(promotionsPath)) { console.log(`promotions.json already exists at ${promotionsPath}`); process.exit(0); }
  fs.mkdirSync(dir, { recursive: true });
  savePromotions({ promotions: [] });
  console.log(`Created ${promotionsPath}`);
}

function cmdAdd() {
  const dataStr = getArg('data');
  if (!dataStr) { console.error('Error: --data required. Example: --data \'{"name":"Pasta Week","type":"discount",...}\''); process.exit(1); }
  let input;
  try { input = JSON.parse(dataStr); } catch (e) { console.error(`Error: Invalid JSON: ${e.message}`); process.exit(1); }
  for (const f of ['name','type','startDate','endDate']) {
    if (!input[f]) { console.error(`Error: Missing required field "${f}".`); process.exit(1); }
  }
  const data = loadPromotions();
  refreshStatuses(data);
  const id = `promo_${input.startDate.replace(/-/g, '')}_${slugify(input.name)}`;
  if (data.promotions.find(p => p.id === id)) { console.error(`Error: Promotion "${id}" already exists.`); process.exit(1); }
  const dur = daysBetween(parseDate(input.startDate), parseDate(input.endDate));
  const promotion = {
    id, name: input.name, type: input.type, discount: input.discount || '',
    items: input.items || [], startDate: input.startDate, endDate: input.endDate,
    terms: input.terms || '', status: computeStatus(input.startDate, input.endDate),
    createdAt: nowISO(),
    contentPlan: {
      teaserPosts: 2, launchPosts: (input.items||[]).length > 1 ? 2 : 1,
      midPromoPosts: dur >= 3 ? 1 : 0, reminderPosts: dur >= 4 ? 1 : 0,
      lastChancePosts: 1, wrapUpPosts: 1
    },
    postsCreated: [], performance: { totalViews: 0, totalBookings: 0 }
  };
  data.promotions.push(promotion);
  savePromotions(data);
  const p = promotion;
  console.log(`Added promotion: ${p.name}`);
  console.log(`  ID: ${p.id}  Status: ${p.status}  Dates: ${p.startDate} to ${p.endDate}`);
  console.log(`  Type: ${p.type}${p.discount ? ` (${p.discount})` : ''}${p.items.length ? '  Items: ' + p.items.join(', ') : ''}`);
  if (p.terms) console.log(`  Terms: ${p.terms}`);
  console.log(`  Content plan: ${planTotal(p.contentPlan)} posts suggested`);
}

function cmdList() {
  const data = loadPromotions();
  if (refreshStatuses(data)) savePromotions(data);
  if (data.promotions.length === 0) { console.log('No promotions found. Use --add to create one.'); return; }
  const groups = { active: [], upcoming: [], ended: [] };
  for (const p of data.promotions) {
    if (p.status === 'active') groups.active.push(p);
    else if (p.status === 'upcoming') groups.upcoming.push(p);
    else groups.ended.push(p);
  }
  console.log(`All Promotions (${data.promotions.length} total)\n`);
  for (const [label, promos] of [['ACTIVE', groups.active], ['UPCOMING', groups.upcoming], ['ENDED', groups.ended]]) {
    if (promos.length === 0) continue;
    console.log(`${label}:`);
    for (const p of promos) {
      if (label === 'ACTIVE') {
        console.log(`  [${p.id}] ${p.name} -- ${p.startDate} to ${p.endDate} (${daysBetween(parseDate(today()), parseDate(p.endDate))} days left)`);
      } else if (label === 'UPCOMING') {
        console.log(`  [${p.id}] ${p.name} -- starts ${p.startDate} (in ${daysBetween(parseDate(today()), parseDate(p.startDate))} days)`);
      } else {
        const suf = p.status === 'ended-early' ? ' (ended early)' : '';
        console.log(`  [${p.id}] ${p.name} -- ${p.startDate} to ${p.endDate}${suf}`);
      }
      if (p.discount) console.log(`    ${p.type}: ${offerStr(p)}`);
    }
    console.log('');
  }
}

function cmdActive() {
  const data = loadPromotions();
  if (refreshStatuses(data)) savePromotions(data);
  const active = data.promotions.filter(p => p.status === 'active');
  if (active.length === 0) { console.log(`No active promotions as of ${today()}.`); return; }
  console.log(`Active Promotions (${today()})\n`);
  for (const p of active) {
    const left = daysBetween(parseDate(today()), parseDate(p.endDate));
    const elapsed = daysBetween(parseDate(p.startDate), parseDate(today()));
    const total = daysBetween(parseDate(p.startDate), parseDate(p.endDate));
    const pct = total > 0 ? Math.round((elapsed / total) * 100) : 100;
    console.log(`  ${p.name}  [${p.id}]`);
    console.log(`    Dates: ${p.startDate} to ${p.endDate}  Progress: Day ${elapsed}/${total} (${pct}%) -- ${left} days left`);
    if (p.discount) console.log(`    Offer: ${offerStr(p)}`);
    if (p.terms) console.log(`    Terms: ${p.terms}`);
    console.log(`    Posts: ${p.postsCreated.length}  Views: ${p.performance.totalViews.toLocaleString()}  Bookings: ${p.performance.totalBookings}\n`);
  }
}

function cmdUpcoming() {
  const data = loadPromotions();
  if (refreshStatuses(data)) savePromotions(data);
  const todayD = parseDate(today()), limit = new Date(todayD.getTime() + 7 * 86400000);
  const upcoming = data.promotions.filter(p => p.status === 'upcoming' && parseDate(p.startDate) <= limit);
  if (upcoming.length === 0) { console.log('No promotions starting within the next 7 days.'); return; }
  console.log(`Upcoming Promotions (next 7 days from ${today()})\n`);
  for (const p of upcoming) {
    const daysUntil = daysBetween(todayD, parseDate(p.startDate));
    console.log(`  ${p.name}  [${p.id}]`);
    console.log(`    Starts: ${p.startDate} (in ${daysUntil} day${daysUntil !== 1 ? 's' : ''})  Ends: ${p.endDate}`);
    if (p.discount) console.log(`    Offer: ${offerStr(p)}`);
    const teaserDate = new Date(parseDate(p.startDate).getTime() - 2 * 86400000).toISOString().slice(0, 10);
    console.log(`    Action: ${teaserDate >= today() ? 'Start teaser posts on ' + teaserDate : 'Teaser window passed -- post launch content on ' + p.startDate}\n`);
  }
}

function cmdEnd() {
  const id = getArg('id');
  if (!id) { console.error('Error: --id is required.'); process.exit(1); }
  const data = loadPromotions();
  refreshStatuses(data);
  const promo = findPromotion(data, id);
  if (promo.status === 'ended' || promo.status === 'ended-early') { console.log(`Promotion "${promo.name}" has already ended.`); process.exit(0); }
  promo.status = 'ended-early';
  promo.endedAt = nowISO();
  promo.originalEndDate = promo.endDate;
  promo.endDate = today();
  savePromotions(data);
  console.log(`Ended promotion: ${promo.name}\n  Original end date: ${promo.originalEndDate}\n  Ended early on:    ${promo.endDate}`);
}

function cmdContentPlan() {
  const id = getArg('id');
  if (!id) { console.error('Error: --id is required.'); process.exit(1); }
  const data = loadPromotions();
  refreshStatuses(data);
  const promo = findPromotion(data, id);
  const plan = buildContentPlan(promo);
  console.log(`Content Plan for "${promo.name}" (${fmtDate(parseDate(promo.startDate))}-${fmtDate(parseDate(promo.endDate))})`);
  for (const e of plan) {
    const label = `Day ${e.day}`;
    const pad = label.length < 6 ? ' '.repeat(6 - label.length) : ' ';
    console.log(`  ${label}${pad}(${fmtDate(parseDate(e.date))}):  ${e.type} -- ${e.suggestion}`);
  }
  promo.contentPlan = countTypes(plan);
  savePromotions(data);
}

function cmdCheckExpiring() {
  const data = loadPromotions();
  if (refreshStatuses(data)) savePromotions(data);
  const todayD = parseDate(today()), in48h = new Date(todayD.getTime() + 2 * 86400000);
  const expiring = data.promotions.filter(p => p.status === 'active' && parseDate(p.endDate) <= in48h);
  if (expiring.length === 0) { console.log('No promotions expiring within 48 hours.'); return; }
  console.log(`WARNING: ${expiring.length} promotion${expiring.length > 1 ? 's' : ''} ending within 48 hours\n`);
  for (const p of expiring) {
    const hrs = Math.round((parseDate(p.endDate).getTime() - todayD.getTime()) / 3600000);
    const item0 = p.items.length > 0 ? p.items[0].toLowerCase() : 'our special';
    console.log(`  ${p.name}  [${p.id}]`);
    console.log(`    Ends: ${p.endDate} (~${hrs} hours remaining)`);
    if (p.discount) console.log(`    Offer: ${offerStr(p)}`);
    console.log(`\n    Suggested last-chance post:`);
    console.log(`    "LAST CHANCE: ${p.discount ? p.discount + ' off ' : ''}${item0} ends ${hrs <= 24 ? 'TONIGHT' : 'TOMORROW'} at [Restaurant]. Don't miss out -- link in bio to book your table."`);
    console.log(`\n    Suggested wrap-up post (for after it ends):`);
    console.log(`    "${p.name} was incredible. Thank you to everyone who came in this week. Stay tuned for what's next..."\n`);
  }
}

function cmdReport() {
  const id = getArg('id');
  if (!id) { console.error('Error: --id is required.'); process.exit(1); }
  const data = loadPromotions();
  refreshStatuses(data);
  const promo = findPromotion(data, id);
  const start = parseDate(promo.startDate), end = parseDate(promo.endDate), dur = daysBetween(start, end);
  console.log(`Promotion Report: ${promo.name}\n${'='.repeat(40)}`);
  console.log(`  ID: ${promo.id}  Type: ${promo.type}${promo.discount ? ` (${promo.discount})` : ''}  Status: ${promo.status}`);
  console.log(`  Dates: ${promo.startDate} to ${promo.endDate} (${dur} days)`);
  if (promo.items.length > 0) console.log(`  Items: ${promo.items.join(', ')}`);
  if (promo.terms) console.log(`  Terms: ${promo.terms}`);
  // Content plan progress
  const planned = planTotal(promo.contentPlan || {}), created = (promo.postsCreated || []).length;
  console.log(`\n  Content Plan: ${created}/${planned} posts created${planned > 0 ? ` (${Math.round((created/planned)*100)}%)` : ''}`);
  // Performance from hook-performance.json
  const hookPath = path.join(dir, 'hook-performance.json');
  let views = promo.performance.totalViews, bookings = promo.performance.totalBookings, hookMatches = [];
  if (fs.existsSync(hookPath)) {
    try {
      const hookData = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
      const promoStart = start.getTime(), promoEnd = end.getTime() + 86400000;
      hookMatches = (hookData.hooks || []).filter(h => {
        if (!h.date) return false;
        const t = parseDate(h.date).getTime();
        return t >= promoStart && t < promoEnd;
      });
      if (hookMatches.length > 0) {
        views = hookMatches.reduce((s, h) => s + (h.views || 0), 0);
        const likes = hookMatches.reduce((s, h) => s + (h.likes || 0), 0);
        const comments = hookMatches.reduce((s, h) => s + (h.comments || 0), 0);
        const shares = hookMatches.reduce((s, h) => s + (h.shares || 0), 0);
        promo.performance.totalViews = views;
        savePromotions(data);
        console.log(`\n  Performance (from hook-performance.json):`);
        console.log(`    Posts: ${hookMatches.length}  Views: ${views.toLocaleString()}  Likes: ${likes.toLocaleString()}  Comments: ${comments.toLocaleString()}  Shares: ${shares.toLocaleString()}`);
        console.log(`    Bookings: ${bookings}`);
        const sorted = [...hookMatches].sort((a, b) => (b.views||0) - (a.views||0));
        console.log('\n    Top posts during promotion:');
        for (const h of sorted.slice(0, 5)) {
          const vStr = h.views > 1000 ? `${(h.views/1000).toFixed(1)}K` : `${h.views}`;
          console.log(`      ${h.date} | ${vStr} views | "${(h.text||h.hook||'').substring(0, 50)}..."`);
        }
      } else {
        console.log(`\n  Performance: No posts found during promotion period.`);
        console.log(`    Views: ${views.toLocaleString()}  Bookings: ${bookings}`);
      }
    } catch (e) {
      console.log(`\n  Warning: Could not read hook-performance.json: ${e.message}`);
      console.log(`  Views: ${views.toLocaleString()}  Bookings: ${bookings}`);
    }
  } else {
    console.log(`\n  Performance: hook-performance.json not found -- no post attribution available.`);
    console.log(`    Views: ${views.toLocaleString()}  Bookings: ${bookings}`);
  }
  // Status-specific guidance
  if (promo.status === 'active') {
    const left = daysBetween(parseDate(today()), parseDate(promo.endDate));
    console.log(`\n  Next steps (${left} days remaining):`);
    if (left <= 2) console.log('    - Post last-chance content TODAY\n    - Prepare wrap-up post');
    else if (left <= 4) console.log('    - Post a reminder\n    - Highlight the most popular item');
    else console.log('    - Continue mid-promo content\n    - Share customer reactions');
  } else if (promo.status === 'ended' || promo.status === 'ended-early') {
    console.log('\n  Post-promotion:\n    - Post wrap-up content\n    - Save winning hooks for future promotions');
    if (views > 0 && hookMatches.length > 0) console.log(`    - Average ${Math.round(views/hookMatches.length).toLocaleString()} views/post`);
  } else if (promo.status === 'upcoming') {
    const until = daysBetween(parseDate(today()), parseDate(promo.startDate));
    console.log(`\n  Pre-launch (starts in ${until} days):`);
    console.log(until <= 2 ? '    - Start posting teaser content NOW' : `    - Begin teaser posts ${until - 2} days from now`);
    console.log('    - Run --content-plan to see the full content calendar');
  }
}

// ==========================================
// Route to command
// ==========================================
if (hasFlag('init')) cmdInit();
else if (hasFlag('add')) cmdAdd();
else if (hasFlag('list')) cmdList();
else if (hasFlag('active')) cmdActive();
else if (hasFlag('upcoming')) cmdUpcoming();
else if (hasFlag('end')) cmdEnd();
else if (hasFlag('content-plan')) cmdContentPlan();
else if (hasFlag('check-expiring')) cmdCheckExpiring();
else if (hasFlag('report')) cmdReport();
else {
  console.error('Error: No command specified.');
  console.error('Use --init, --add, --list, --active, --upcoming, --end, --content-plan, --check-expiring, or --report.');
  process.exit(1);
}
