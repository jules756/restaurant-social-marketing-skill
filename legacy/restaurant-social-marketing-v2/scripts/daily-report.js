#!/usr/bin/env node
/**
 * Daily Marketing Report (Restaurant Edition)
 *
 * Cross-references multi-platform post analytics (via Composio) with restaurant booking data
 * to identify which hooks drive views AND reservations.
 *
 * Data sources:
 * 1. Composio API -> account-level TikTok/Instagram/Facebook stats
 * 2. Composio API -> per-video TikTok analytics (views, likes, comments, shares)
 * 3. bookings.json -> manual booking/cover counts per day
 * 4. Knowledge base (menu) -> content suggestions for unfeatured items
 * 5. promotions.json -> active/upcoming promotion tracking
 *
 * The diagnostic framework:
 * - High views + More bookings  -> SCALE IT (make variations of winning hooks)
 * - High views + Same bookings  -> FIX THE CTA (hook works, booking page/CTA is broken)
 * - Low views + More bookings   -> FIX THE HOOKS (content converts, needs more eyeballs)
 * - Low views + Same bookings   -> FULL RESET (try radically different approach)
 *
 * Usage: node daily-report.js --config <config.json> [--days 3]
 * Output: tiktok-marketing/reports/YYYY-MM-DD.md
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const days = parseInt(getArg('days') || '3');

if (!configPath) {
  console.error('Usage: node daily-report.js --config <config.json> [--days 3]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const baseDir = path.dirname(configPath);

const COMPOSIO_URL = 'https://backend.composio.dev';

// ==========================================
// Determine enabled platforms (E1)
// ==========================================

const enabledPlatforms = [];
if (config.composio?.connectedAccounts?.tiktok) enabledPlatforms.push('tiktok');
if (config.composio?.connectedAccounts?.instagram) enabledPlatforms.push('instagram');
if (config.composio?.connectedAccounts?.facebook) enabledPlatforms.push('facebook');

// ==========================================
// Composio API helpers
// ==========================================

async function composioExecute(toolSlug, arguments_, platform = 'tiktok') {
  const connectedAccountId = config.composio.connectedAccounts[platform];
  if (!connectedAccountId) return null;
  const res = await fetch(`${COMPOSIO_URL}/api/v3/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.composio.apiKey
    },
    body: JSON.stringify({
      connected_account_id: connectedAccountId,
      user_id: config.composio.userId,
      arguments: arguments_ || {}
    })
  });
  return res.json();
}

async function composioProxy(endpoint, fields, videoIds) {
  const body = {
    connected_account_id: config.composio.connectedAccounts.tiktok,
    user_id: config.composio.userId,
    arguments: {
      endpoint,
      method: 'POST',
      body: {
        filters: { video_ids: videoIds },
        fields
      }
    }
  };
  const res = await fetch(`${COMPOSIO_URL}/api/v3/tools/execute/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.composio.apiKey
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==========================================
// Booking data (manual from bookings.json)
// ==========================================

function loadBookingData() {
  const bookingPath = path.join(baseDir, 'bookings.json');
  if (fs.existsSync(bookingPath)) {
    return JSON.parse(fs.readFileSync(bookingPath, 'utf-8'));
  }
  return null;
}

function getBookingsForDate(bookingData, dateStr) {
  if (!bookingData || !bookingData.entries) return null;
  return bookingData.entries.find(e => e.date === dateStr) || null;
}

function getBookingsInRange(bookingData, startDate, endDate) {
  if (!bookingData || !bookingData.entries) return [];
  return bookingData.entries.filter(e => {
    const d = new Date(e.date);
    return d >= startDate && d <= endDate;
  });
}

// ==========================================
// Snapshot helpers for delta tracking
// ==========================================

function loadPreviousPlatformStats() {
  const statsPath = path.join(baseDir, 'platform-stats.json');
  if (fs.existsSync(statsPath)) {
    return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
  }
  return null;
}

function savePlatformStats(stats) {
  const statsPath = path.join(baseDir, 'platform-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

(async () => {
  const now = new Date();
  const startDate = new Date(now - days * 86400000);
  const dateStr = now.toISOString().slice(0, 10);

  console.log(`Daily Report -- ${dateStr} (last ${days} days)\n`);

  // ==========================================
  // 1. COMPOSIO: Account-level stats (multi-platform)
  // ==========================================
  const allPlatformStats = {};

  // --- TikTok ---
  if (enabledPlatforms.includes('tiktok')) {
    console.log('  Fetching TikTok account stats via Composio...');
    try {
      const statsRes = await composioExecute('TIKTOK_GET_USER_STATS', {}, 'tiktok');
      const accountStats = statsRes?.data || statsRes || {};
      allPlatformStats.tiktok = {
        followers: accountStats?.follower_count || accountStats?.followers || 0,
        totalLikes: accountStats?.likes_count || accountStats?.total_likes || 0,
        videoCount: accountStats?.video_count || 0
      };
    } catch (e) {
      console.log(`  WARNING: Could not fetch TikTok account stats: ${e.message}`);
    }
  }

  // --- Instagram (E1) ---
  if (enabledPlatforms.includes('instagram')) {
    console.log('  Fetching Instagram account stats via Composio...');
    try {
      const igStats = await composioExecute('INSTAGRAM_GET_USER_INSIGHTS', {}, 'instagram');
      const igData = igStats?.data || igStats || {};
      allPlatformStats.instagram = {
        followers: igData?.follower_count || igData?.followers || 0,
        totalLikes: igData?.likes_count || igData?.total_likes || 0,
        reach: igData?.reach || 0,
        impressions: igData?.impressions || 0
      };
    } catch (e) {
      console.log(`  WARNING: Could not fetch Instagram stats: ${e.message}`);
    }
  }

  // --- Facebook (E1) ---
  if (enabledPlatforms.includes('facebook')) {
    console.log('  Fetching Facebook page stats via Composio...');
    try {
      const fbStats = await composioExecute('FACEBOOK_GET_PAGE_INSIGHTS', {
        since: Math.floor(startDate.getTime() / 1000),
        until: Math.floor(now.getTime() / 1000)
      }, 'facebook');
      const fbData = fbStats?.data || fbStats || {};
      allPlatformStats.facebook = {
        followers: fbData?.fan_count || fbData?.followers || 0,
        totalLikes: fbData?.page_likes || fbData?.total_likes || 0,
        reach: fbData?.reach || 0,
        engagement: fbData?.engagement || 0
      };
    } catch (e) {
      console.log(`  WARNING: Could not fetch Facebook stats: ${e.message}`);
    }
  }

  // Save current stats for delta tracking (use TikTok as primary for backward compat)
  const prevPlatformStats = loadPreviousPlatformStats();
  const currentPlatformStats = allPlatformStats.tiktok || {
    followers: 0,
    totalLikes: 0,
    videoCount: 0
  };
  savePlatformStats({ date: dateStr, stats: currentPlatformStats, allPlatforms: allPlatformStats });

  // ==========================================
  // 2. COMPOSIO: List recent videos (TikTok)
  // ==========================================
  console.log('  Fetching recent videos via Composio...');
  let videos = [];
  try {
    const listRes = await composioExecute('TIKTOK_LIST_VIDEOS', {}, 'tiktok');
    const rawVideos = listRes?.data?.videos || listRes?.videos || [];
    // Filter to videos within our date range
    videos = rawVideos.filter(v => {
      const created = new Date((v.create_time || 0) * 1000);
      return created >= startDate && created <= now;
    });
    videos.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
  } catch (e) {
    console.log(`  WARNING: Could not list videos: ${e.message}`);
  }

  console.log(`  Found ${videos.length} TikTok videos in range\n`);

  // ==========================================
  // 3. COMPOSIO: Per-video analytics via proxy
  // ==========================================
  const postResults = [];
  if (videos.length > 0) {
    console.log('  Fetching per-video analytics via Composio proxy...');
    const videoIds = videos.map(v => v.id);
    const analyticsFields = [
      'id', 'title', 'view_count', 'like_count',
      'comment_count', 'share_count', 'create_time'
    ];

    try {
      // Batch in groups of 20 (TikTok API limit)
      for (let i = 0; i < videoIds.length; i += 20) {
        const batch = videoIds.slice(i, i + 20);
        const analyticsRes = await composioProxy(
          'https://open.tiktokapis.com/v2/video/query/',
          analyticsFields,
          batch
        );

        const videoData = analyticsRes?.data?.videos || analyticsRes?.videos || [];
        for (const v of videoData) {
          const createdDate = v.create_time
            ? new Date(v.create_time * 1000).toISOString().slice(0, 10)
            : 'unknown';
          postResults.push({
            id: v.id,
            date: createdDate,
            hook: (v.title || '').substring(0, 70),
            views: v.view_count || 0,
            likes: v.like_count || 0,
            comments: v.comment_count || 0,
            shares: v.share_count || 0
          });
        }

        if (i + 20 < videoIds.length) await sleep(300);
      }
    } catch (e) {
      console.log(`  WARNING: Could not fetch video analytics: ${e.message}`);
      // Fall back to metadata from the list call
      for (const v of videos) {
        const createdDate = v.create_time
          ? new Date(v.create_time * 1000).toISOString().slice(0, 10)
          : 'unknown';
        postResults.push({
          id: v.id,
          date: createdDate,
          hook: (v.title || '').substring(0, 70),
          views: v.view_count || 0,
          likes: v.like_count || 0,
          comments: v.comment_count || 0,
          shares: v.share_count || 0
        });
      }
    }
  }

  // Sort by views descending
  postResults.sort((a, b) => b.views - a.views);

  // ==========================================
  // 4. BOOKING DATA
  // ==========================================
  const bookingData = loadBookingData();
  const todayBooking = getBookingsForDate(bookingData, dateStr);
  const rangeBookings = getBookingsInRange(bookingData, startDate, now);
  const baseline = bookingData?.baseline || { avgDailyBookings: 45, avgDailyCovers: 100 };

  // ==========================================
  // 5. GENERATE REPORT
  // ==========================================
  const restaurantName = config.restaurant?.name || 'Restaurant';
  let report = `# Daily Marketing Report -- ${dateStr}\n`;
  report += `**${restaurantName}** | Last ${days} days\n\n`;

  // --- Account Stats (TikTok primary) ---
  report += `## Account Stats (TikTok)\n\n`;
  report += `| Metric | Current | Delta |\n`;
  report += `|--------|--------:|------:|\n`;

  const followerDelta = prevPlatformStats
    ? currentPlatformStats.followers - (prevPlatformStats.stats?.followers || 0)
    : null;
  const likesDelta = prevPlatformStats
    ? currentPlatformStats.totalLikes - (prevPlatformStats.stats?.totalLikes || 0)
    : null;
  const videoDelta = prevPlatformStats
    ? currentPlatformStats.videoCount - (prevPlatformStats.stats?.videoCount || 0)
    : null;

  report += `| Followers | ${currentPlatformStats.followers.toLocaleString()} | ${followerDelta !== null ? (followerDelta >= 0 ? '+' : '') + followerDelta.toLocaleString() : 'N/A'} |\n`;
  report += `| Total Likes | ${currentPlatformStats.totalLikes.toLocaleString()} | ${likesDelta !== null ? (likesDelta >= 0 ? '+' : '') + likesDelta.toLocaleString() : 'N/A'} |\n`;
  report += `| Videos | ${currentPlatformStats.videoCount} | ${videoDelta !== null ? (videoDelta >= 0 ? '+' : '') + videoDelta : 'N/A'} |\n`;
  report += '\n';

  // --- Cross-Platform Summary (E1) ---
  if (enabledPlatforms.length > 1) {
    report += `## Cross-Platform Summary\n\n`;
    report += `| Platform | Followers | Likes | Other |\n`;
    report += `|----------|----------:|------:|-------|\n`;

    if (allPlatformStats.tiktok) {
      report += `| TikTok | ${allPlatformStats.tiktok.followers.toLocaleString()} | ${allPlatformStats.tiktok.totalLikes.toLocaleString()} | ${allPlatformStats.tiktok.videoCount} videos |\n`;
    }
    if (allPlatformStats.instagram) {
      report += `| Instagram | ${allPlatformStats.instagram.followers.toLocaleString()} | ${allPlatformStats.instagram.totalLikes.toLocaleString()} | Reach: ${allPlatformStats.instagram.reach.toLocaleString()} |\n`;
    }
    if (allPlatformStats.facebook) {
      report += `| Facebook | ${allPlatformStats.facebook.followers.toLocaleString()} | ${allPlatformStats.facebook.totalLikes.toLocaleString()} | Reach: ${allPlatformStats.facebook.reach.toLocaleString()} |\n`;
    }

    const totalFollowers = Object.values(allPlatformStats).reduce((s, p) => s + (p.followers || 0), 0);
    const totalLikes = Object.values(allPlatformStats).reduce((s, p) => s + (p.totalLikes || 0), 0);
    report += `| **Total** | **${totalFollowers.toLocaleString()}** | **${totalLikes.toLocaleString()}** | ${enabledPlatforms.length} platforms |\n`;
    report += '\n';

    // Identify strongest platform
    const platformsByFollowers = Object.entries(allPlatformStats)
      .sort((a, b) => (b[1].followers || 0) - (a[1].followers || 0));
    if (platformsByFollowers.length > 0) {
      report += `**Strongest platform by followers:** ${platformsByFollowers[0][0]} (${platformsByFollowers[0][1].followers.toLocaleString()})\n\n`;
    }
  }

  // --- Recent Videos ---
  report += `## Recent Videos\n\n`;
  if (postResults.length > 0) {
    report += `| Date | Hook | Views | Likes | Comments | Shares |\n`;
    report += `|------|------|------:|------:|---------:|-------:|\n`;

    for (const p of postResults) {
      const viewStr = p.views > 1000 ? `${(p.views / 1000).toFixed(1)}K` : `${p.views}`;
      report += `| ${p.date} | ${p.hook.substring(0, 45)}... | ${viewStr} | ${p.likes} | ${p.comments} | ${p.shares} |\n`;
    }

    const totalViews = postResults.reduce((s, p) => s + p.views, 0);
    const avgViews = postResults.length > 0 ? Math.round(totalViews / postResults.length) : 0;
    report += `\n**Total views:** ${totalViews.toLocaleString()} | **Avg per video:** ${avgViews.toLocaleString()}\n\n`;
  } else {
    report += `No videos found in the last ${days} days.\n\n`;
  }

  // --- Booking Data ---
  report += `## Booking Data\n\n`;

  if (todayBooking) {
    const bookingDelta = todayBooking.bookings - baseline.avgDailyBookings;
    const coverDelta = todayBooking.covers - baseline.avgDailyCovers;
    report += `### Today (${dateStr})\n\n`;
    report += `| Metric | Today | Baseline | Delta |\n`;
    report += `|--------|------:|---------:|------:|\n`;
    report += `| Bookings | ${todayBooking.bookings} | ${baseline.avgDailyBookings} | ${bookingDelta >= 0 ? '+' : ''}${bookingDelta} |\n`;
    report += `| Covers | ${todayBooking.covers} | ${baseline.avgDailyCovers} | ${coverDelta >= 0 ? '+' : ''}${coverDelta} |\n`;
    report += '\n';
  } else {
    report += `No booking data for today (${dateStr}). Update bookings.json to track.\n\n`;
  }

  if (rangeBookings.length > 0) {
    const avgBookings = Math.round(rangeBookings.reduce((s, e) => s + e.bookings, 0) / rangeBookings.length);
    const avgCovers = Math.round(rangeBookings.reduce((s, e) => s + e.covers, 0) / rangeBookings.length);
    const rangeDelta = avgBookings - baseline.avgDailyBookings;
    report += `### ${days}-Day Average\n\n`;
    report += `- **Avg daily bookings:** ${avgBookings} (baseline ${baseline.avgDailyBookings}, delta ${rangeDelta >= 0 ? '+' : ''}${rangeDelta})\n`;
    report += `- **Avg daily covers:** ${avgCovers} (baseline ${baseline.avgDailyCovers})\n`;
    report += `- **Days tracked:** ${rangeBookings.length}\n\n`;
  }

  // ==========================================
  // 6. DIAGNOSTIC FRAMEWORK
  // ==========================================
  report += `## Diagnosis\n\n`;

  const totalViews = postResults.reduce((s, p) => s + p.views, 0);
  const avgViews = postResults.length > 0 ? Math.round(totalViews / postResults.length) : 0;
  const viewsGood = avgViews > 10000;

  // Determine booking health
  let bookingsUp = false;
  let hasBookingData = false;
  if (rangeBookings.length > 0) {
    hasBookingData = true;
    const avgBookings = rangeBookings.reduce((s, e) => s + e.bookings, 0) / rangeBookings.length;
    bookingsUp = avgBookings > baseline.avgDailyBookings;
  }

  if (viewsGood && bookingsUp) {
    report += `### SCALE IT\n\n`;
    report += `Views are strong (avg ${avgViews.toLocaleString()} per video) and bookings are above baseline.\n`;
    report += `- Make 3 variations of the top-performing hooks\n`;
    report += `- Test different posting times for optimization\n`;
    report += `- Cross-post to Instagram Reels and YouTube Shorts\n`;
    report += `- Consider running the winning hooks as paid ads\n\n`;
  } else if (viewsGood && hasBookingData && !bookingsUp) {
    report += `### FIX THE CTA\n\n`;
    report += `Views are strong (avg ${avgViews.toLocaleString()} per video) but bookings are flat or below baseline.\n`;
    report += `The hooks are working -- people are watching -- but the booking path is broken.\n`;
    report += `- Check the link in bio / booking link is working\n`;
    report += `- Try a more direct CTA ("Book now", "Reserve tonight")\n`;
    report += `- Verify the ${config.bookingTracking?.platform || 'booking'} page matches the video promise\n`;
    report += `- Test different caption structures with clear booking CTAs\n`;
    report += `- DO NOT change the hooks -- they are working\n\n`;
  } else if (!viewsGood && hasBookingData && bookingsUp) {
    report += `### FIX THE HOOKS\n\n`;
    report += `Bookings are above baseline but views are low (avg ${avgViews.toLocaleString()} per video).\n`;
    report += `People who see the content are booking, but not enough people are seeing it.\n`;
    report += `- Test radically different hook categories\n`;
    report += `- Try person+conflict, POV, listicle, mistakes formats\n`;
    report += `- Test different posting times and thumbnails\n`;
    report += `- DO NOT change the CTA -- it is converting to reservations\n\n`;
  } else {
    report += `### FULL RESET\n\n`;
    report += `Views are low (avg ${avgViews.toLocaleString()} per video)`;
    if (hasBookingData) {
      report += ` and bookings are flat or below baseline`;
    } else {
      report += ` (no booking data available -- update bookings.json)`;
    }
    report += `.\n`;
    report += `- Try a radically different format or approach\n`;
    report += `- Research what restaurant content is trending RIGHT NOW\n`;
    report += `- Consider a different target audience angle\n`;
    report += `- Test new hook categories from scratch\n\n`;
  }

  // ==========================================
  // 7. PER-VIDEO DIAGNOSTIC
  // ==========================================
  const hookPath = path.join(baseDir, 'hook-performance.json');
  let hookData = { hooks: [], rules: { doubleDown: [], testing: [], dropped: [] } };
  if (fs.existsSync(hookPath)) {
    hookData = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
  }

  // Compute booking delta for the reporting period
  let periodBookingDelta = 0;
  if (rangeBookings.length > 0) {
    const avgBookings = rangeBookings.reduce((s, e) => s + e.bookings, 0) / rangeBookings.length;
    periodBookingDelta = avgBookings - baseline.avgDailyBookings;
  }

  // Update hook performance
  for (const p of postResults) {
    const existing = hookData.hooks.find(h => h.postId === p.id);
    if (existing) {
      existing.views = p.views;
      existing.likes = p.likes;
      existing.comments = p.comments;
      existing.shares = p.shares;
      existing.lastChecked = dateStr;
    } else {
      hookData.hooks.push({
        postId: p.id,
        text: p.hook,
        date: p.date,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        cta: '',
        lastChecked: dateStr
      });
    }
  }
  fs.writeFileSync(hookPath, JSON.stringify(hookData, null, 2));

  // Per-video diagnosis
  report += `## Per-Video Diagnostic\n\n`;

  const recentHooks = hookData.hooks.filter(h => h.lastChecked === dateStr);
  if (recentHooks.length > 0 && hasBookingData) {
    const sorted = [...recentHooks].sort((a, b) => b.views - a.views);
    const viewMedian = sorted[Math.floor(sorted.length / 2)]?.views || 1000;

    for (const h of sorted) {
      const highViews = h.views > viewMedian && h.views > 5000;
      report += `**"${h.text.substring(0, 55)}..."** -- ${h.views.toLocaleString()} views\n`;

      if (highViews && bookingsUp) {
        report += `  SCALE -- Hook is driving views and bookings are up. Make variations.\n`;
      } else if (highViews && !bookingsUp) {
        report += `  FIX CTA -- High views but bookings flat. Hook works, change the booking CTA.\n`;
      } else if (!highViews && bookingsUp) {
        report += `  FIX HOOK -- Low views but bookings are up from other content. Strengthen this hook.\n`;
      } else {
        report += `  DROP -- Low views and bookings are not improving. Try a different hook and CTA.\n`;
      }
      report += '\n';
    }
  } else if (!hasBookingData) {
    report += `No booking data available -- update bookings.json to enable per-video booking attribution.\n\n`;
  } else {
    report += `No recent videos to diagnose.\n\n`;
  }

  // ==========================================
  // 8. HOOK PERFORMANCE ANALYSIS
  // ==========================================
  report += `## Hook Performance Analysis\n\n`;

  const allHistorical = hookData.hooks.filter(h => h.views > 0);

  if (allHistorical.length > 0) {
    allHistorical.sort((a, b) => b.views - a.views);
    const winners = allHistorical.filter(h => h.views >= 10000);
    const losers = allHistorical.filter(h => h.views < 1000);

    if (winners.length > 0) {
      report += `**Winning hooks (10K+ views):**\n`;
      for (const w of winners.slice(0, 5)) {
        report += `- "${w.text.substring(0, 60)}..." -- ${w.views.toLocaleString()} views\n`;
      }
      report += '\n';

      // Extract patterns from winners
      const winnerTexts = winners.map(w => w.text.toLowerCase());
      const patterns = {
        personConflict: winnerTexts.filter(t => /\b(showed|told|said|asked)\b/.test(t) && /\b(my |mum|mom|dad|landlord|boyfriend|girlfriend|friend|sister|brother|boss|nan|chef)\b/.test(t)).length,
        pov: winnerTexts.filter(t => t.startsWith('pov')).length,
        question: winnerTexts.filter(t => t.includes('?')).length,
        emotion: winnerTexts.filter(t => /\b(obsessed|can't believe|shocked|never thought|didn't expect)\b/.test(t)).length,
        food: winnerTexts.filter(t => /\b(recipe|dish|menu|kitchen|cooking|secret|ingredient)\b/.test(t)).length
      };

      const topPattern = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0];
      if (topPattern[1] > 0) {
        report += `**Strongest pattern:** ${topPattern[0]} (${topPattern[1]}/${winners.length} winners use this)\n\n`;
      }

      report += `**Generated hook suggestions (based on your winners):**\n\n`;
      report += `The agent should generate 3-5 NEW hooks that follow the "${topPattern[0]}" pattern, using:\n`;
      report += `- ${restaurantName}'s unique selling points from config\n`;
      report += `- The winning hook structures above as templates\n`;
      report += `- Different people/scenarios to keep it fresh\n\n`;
      report += `**AGENT INSTRUCTION:** Read the winning hooks above. Identify the structure. `;
      report += `Generate 3 new hooks that follow the SAME structure but with different people and scenarios. `;
      report += `Focus on restaurant-specific angles: food reveals, behind-the-kitchen, chef reactions, customer reactions.\n\n`;
    }

    if (losers.length > 0) {
      report += `**Drop these patterns (< 1K views):**\n`;
      for (const l of losers.slice(0, 3)) {
        report += `- "${l.text.substring(0, 60)}..." -- ${l.views} views\n`;
      }
      report += '\n';
    }
  } else {
    report += `No historical hook data yet. Performance analysis will appear after the first report cycle.\n\n`;
  }

  // ==========================================
  // 9. AUTO-GENERATED RECOMMENDATIONS
  // ==========================================
  report += `## Recommendations\n\n`;

  // Booking-specific recommendations
  if (hasBookingData) {
    if (bookingsUp && viewsGood) {
      report += `- Bookings and views both strong. Double down on current strategy.\n`;
      report += `- Test paid promotion on your top-performing video to amplify results.\n`;
      report += `- Add a "Book now" overlay or pinned comment to high-view videos.\n`;
    } else if (!bookingsUp && viewsGood) {
      report += `- Views are healthy but bookings are not increasing. The content-to-booking funnel is broken.\n`;
      report += `- Audit the link in bio -- is the booking page mobile-friendly?\n`;
      report += `- Try more direct CTAs: "Reserve your table -- link in bio"\n`;
      report += `- Check ${config.bookingTracking?.platform || 'booking platform'} for UX issues on mobile.\n`;
      report += `- Test a limited-time offer CTA to create urgency.\n`;
    } else if (bookingsUp && !viewsGood) {
      report += `- Bookings are growing despite low views -- your existing audience converts well.\n`;
      report += `- Focus entirely on increasing reach: new hook styles, trending sounds, collaborations.\n`;
      report += `- DO NOT change your CTA or booking flow.\n`;
    } else {
      report += `- Both views and bookings need attention. Consider:\n`;
      report += `  - Research trending restaurant content in your area\n`;
      report += `  - Try behind-the-scenes kitchen content\n`;
      report += `  - Feature customer reactions and food reveals\n`;
      report += `  - Collaborate with local food creators\n`;
      report += `  - Test radically different posting times\n`;
    }
  } else {
    report += `- WARNING: No booking data available. Update bookings.json to enable full diagnostic.\n`;
    report += `- Without booking data, only view-based analysis is possible.\n`;
  }

  report += '\n';

  // ==========================================
  // 10. CONTENT SUGGESTIONS FROM MENU (E2)
  // ==========================================
  const kbMenuPath = config.knowledgeBase?.menu;
  if (kbMenuPath && fs.existsSync(kbMenuPath)) {
    try {
      const menu = JSON.parse(fs.readFileSync(kbMenuPath, 'utf-8'));
      const allItems = menu.sections.flatMap(s => s.items);
      const unfeatured = allItems.filter(item => (item.featuredInPosts || 0) === 0);
      const signature = allItems.filter(item => item.isSignature);

      if (unfeatured.length > 0) {
        report += `## Menu Items Not Yet Featured\n\n`;
        report += `${unfeatured.length} dishes haven't appeared in any post yet:\n\n`;
        for (const item of unfeatured.slice(0, 5)) {
          report += `- **${item.name}** ($${item.price}) — ${item.description?.substring(0, 60)}...\n`;
        }
        report += `\nConsider featuring these in upcoming content.\n\n`;
      }

      if (signature.length > 0) {
        report += `## Signature Items to Highlight\n\n`;
        for (const item of signature) {
          report += `- **${item.name}** ($${item.price}) — featured in ${item.featuredInPosts || 0} post(s)\n`;
        }
        report += '\n';
      }
    } catch (e) {
      console.log(`  WARNING: Could not load menu knowledge base: ${e.message}`);
    }
  }

  // ==========================================
  // 11. ACTIVE PROMOTIONS (E4)
  // ==========================================
  const promoPath = path.join(baseDir, 'promotions.json');
  if (fs.existsSync(promoPath)) {
    try {
      const promoData = JSON.parse(fs.readFileSync(promoPath, 'utf-8'));
      const today = new Date();

      // Update statuses
      const active = promoData.promotions.filter(p => {
        const start = new Date(p.startDate);
        const end = new Date(p.endDate);
        return today >= start && today <= end && p.status !== 'ended-early';
      });

      const expiringSoon = active.filter(p => {
        const end = new Date(p.endDate);
        const hoursLeft = (end - today) / 3600000;
        return hoursLeft <= 48;
      });

      if (active.length > 0) {
        report += `## Active Promotions\n\n`;
        for (const promo of active) {
          const end = new Date(promo.endDate);
          const daysLeft = Math.ceil((end - today) / 86400000);
          report += `**${promo.name}** — ${promo.discount || promo.type} on ${promo.items.join(', ')}\n`;
          report += `Ends in ${daysLeft} day(s) (${promo.endDate})\n`;
          report += `Posts created: ${promo.postsCreated?.length || 0}\n\n`;
        }
      }

      if (expiringSoon.length > 0) {
        report += `### Expiring Soon (within 48h)\n\n`;
        for (const promo of expiringSoon) {
          report += `**${promo.name}** ends ${promo.endDate} — schedule LAST CHANCE and WRAP-UP posts!\n`;
        }
        report += '\n';
      }

      // Upcoming promotions
      const upcoming = promoData.promotions.filter(p => {
        const start = new Date(p.startDate);
        return start > today && (start - today) / 86400000 <= 7;
      });

      if (upcoming.length > 0) {
        report += `### Upcoming (next 7 days)\n\n`;
        for (const promo of upcoming) {
          const daysUntil = Math.ceil((new Date(promo.startDate) - today) / 86400000);
          report += `**${promo.name}** starts in ${daysUntil} day(s) — schedule TEASER posts!\n`;
        }
        report += '\n';
      }
    } catch (e) {
      console.log(`  WARNING: Could not load promotions: ${e.message}`);
    }
  }

  // ==========================================
  // 12. SAVE REPORT
  // ==========================================
  const reportsDir = path.join(baseDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${dateStr}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport saved to ${reportPath}`);
  console.log('\n' + report);
})();
