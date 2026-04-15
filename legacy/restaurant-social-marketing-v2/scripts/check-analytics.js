#!/usr/bin/env node
/**
 * Multi-Platform Analytics Checker (Composio API)
 *
 * Fetches analytics data from TikTok, Instagram, and Facebook via Composio,
 * matches videos to local posts, and pulls per-video analytics through
 * the TikTok proxy endpoint.
 *
 * How it works:
 * 1. Lists TikTok videos via TIKTOK_LIST_VIDEOS (Composio tool execution)
 * 2. Scans local post directories for meta.json files to know what was posted
 * 3. Matches local posts to TikTok videos by timing (create_time vs postedAt)
 *    or by publish_id if one was recorded
 * 4. Fetches per-video analytics (views, likes, comments, shares) via the
 *    Composio proxy endpoint to the TikTok Query API
 * 5. Fetches Instagram user insights and per-media insights
 * 6. Fetches Facebook page insights
 * 7. Generates and saves an analytics-snapshot.json
 *
 * Config structure:
 * {
 *   "composio": {
 *     "apiKey": "composio-api-key",
 *     "connectedAccounts": {
 *       "tiktok": "ca_xxxxx",
 *       "instagram": "ca_yyyyy",
 *       "facebook": "ca_zzzzz"
 *     },
 *     "userId": "user_123"
 *   }
 * }
 *
 * Usage: node check-analytics.js --config <config.json> [--days 3] [--platform all|tiktok|instagram|facebook]
 */

const fs = require('fs');
const path = require('path');

// --- CLI argument parsing ---

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const days = parseInt(getArg('days') || '3', 10);
const platformFilter = (getArg('platform') || 'all').toLowerCase();

const validPlatforms = ['all', 'tiktok', 'instagram', 'facebook'];
if (!validPlatforms.includes(platformFilter)) {
  console.error(`Invalid platform "${platformFilter}". Must be one of: ${validPlatforms.join(', ')}`);
  process.exit(1);
}

if (!configPath) {
  console.error('Usage: node check-analytics.js --config <config.json> [--days 3] [--platform all|tiktok|instagram|facebook]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const BASE_URL = 'https://backend.composio.dev';
const API_KEY = config.composio.apiKey;
const USER_ID = config.composio.userId;

// --- Connected account helper ---

/**
 * Get the connected account ID for a given platform.
 */
function getConnectedAccount(platform) {
  return config.composio?.connectedAccounts?.[platform];
}

// --- Composio helpers ---

/**
 * Execute a Composio tool.
 * All Composio operations go through POST /api/v3/tools/execute/{toolSlug}.
 */
async function executeTool(toolSlug, toolArguments = {}, connectedAccount) {
  const url = `${BASE_URL}/api/v3/tools/execute/${toolSlug}`;
  const body = {
    connected_account_id: connectedAccount,
    user_id: USER_ID,
    arguments: toolArguments
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio ${toolSlug} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Execute a proxy request through Composio (for direct TikTok API calls).
 */
async function executeProxy(proxyBody, connectedAccount) {
  const url = `${BASE_URL}/api/v3/tools/execute/proxy`;
  const body = {
    connected_account_id: connectedAccount,
    ...proxyBody
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio proxy failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Instagram insight parser ---

/**
 * Parse Instagram insights response into a flat metrics object.
 */
function parseInsights(insightsResult) {
  const metrics = {};
  const data = insightsResult?.data?.data || insightsResult?.data || [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.name && item.values && item.values.length > 0) {
        metrics[item.name] = item.values[0].value;
      }
    }
  }
  return metrics;
}

// --- Local post discovery ---

/**
 * Scan directories adjacent to the config file for meta.json files.
 * Each meta.json represents a locally-posted TikTok slideshow.
 * Expected fields: postId, caption, title, postedAt, publish_id (optional).
 */
function loadLocalPosts(baseDir) {
  const posts = [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(baseDir, entry.name, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        posts.push({
          dir: entry.name,
          metaPath,
          ...meta
        });
      } catch {
        // Skip malformed meta files
      }
    }
  }

  // Sort by postedAt ascending (oldest first)
  posts.sort((a, b) => new Date(a.postedAt || 0) - new Date(b.postedAt || 0));
  return posts;
}

// --- Matching logic ---

/**
 * Match local posts to TikTok videos.
 *
 * Strategy (in priority order):
 * 1. If a local post has a publish_id that matches a TikTok video id, use that.
 * 2. Otherwise, match by closest create_time to postedAt (within a 2-hour window).
 *    TikTok indexing can delay video appearance by 1-2 hours, so we allow a window
 *    where the video create_time is 0-2 hours after the local postedAt timestamp.
 */
function matchPostsToVideos(localPosts, tiktokVideos) {
  const matched = [];
  const usedVideoIds = new Set();

  // Pass 1: exact publish_id match
  for (const post of localPosts) {
    if (!post.publish_id) continue;
    const video = tiktokVideos.find(v => v.id === post.publish_id);
    if (video && !usedVideoIds.has(video.id)) {
      matched.push({ post, video, matchType: 'publish_id' });
      usedVideoIds.add(video.id);
    }
  }

  // Pass 2: timing-based match for remaining unmatched posts
  const matchedPostDirs = new Set(matched.map(m => m.post.dir));

  for (const post of localPosts) {
    if (matchedPostDirs.has(post.dir)) continue;
    if (!post.postedAt) continue;

    const postTime = new Date(post.postedAt).getTime();
    let bestVideo = null;
    let bestDelta = Infinity;

    for (const video of tiktokVideos) {
      if (usedVideoIds.has(video.id)) continue;

      // create_time from TikTok is a Unix timestamp (seconds)
      const videoTime = (typeof video.create_time === 'number'
        ? video.create_time * 1000
        : new Date(video.create_time).getTime());

      const delta = Math.abs(videoTime - postTime);
      // Allow up to 2 hours of drift
      if (delta < 2 * 3600 * 1000 && delta < bestDelta) {
        bestDelta = delta;
        bestVideo = video;
      }
    }

    if (bestVideo) {
      matched.push({ post, video: bestVideo, matchType: 'timing' });
      usedVideoIds.add(bestVideo.id);
      matchedPostDirs.add(post.dir);
    }
  }

  return matched;
}

// --- Platform-specific analytics fetchers ---

/**
 * Fetch Instagram analytics: user insights and per-media insights for recent posts.
 */
async function fetchInstagramAnalytics() {
  const connectedAccount = getConnectedAccount('instagram');
  if (!connectedAccount) return null;

  console.log('Fetching Instagram analytics...\n');

  // Get user insights
  const userInsights = await executeTool('INSTAGRAM_GET_USER_INSIGHTS', {}, connectedAccount);

  // Get recent media
  const media = await executeTool('INSTAGRAM_GET_IG_USER_MEDIA', {}, connectedAccount);

  // Get per-media insights for recent posts
  const results = [];
  if (media?.data?.data) {
    for (const post of media.data.data.slice(0, 10)) {
      const insights = await executeTool('INSTAGRAM_GET_IG_MEDIA_INSIGHTS', { media_id: post.id }, connectedAccount);
      results.push({
        id: post.id,
        caption: (post.caption || '').substring(0, 60),
        timestamp: post.timestamp,
        platform: 'instagram',
        ...parseInsights(insights)
      });
      await sleep(500);
    }
  }

  return { userInsights, posts: results };
}

/**
 * Fetch Facebook page insights for the configured date range.
 */
async function fetchFacebookAnalytics(startDate, now) {
  const connectedAccount = getConnectedAccount('facebook');
  if (!connectedAccount) return null;

  console.log('Fetching Facebook analytics...\n');

  // Get page insights
  const pageInsights = await executeTool('FACEBOOK_GET_PAGE_INSIGHTS', {
    since: Math.floor(startDate.getTime() / 1000),
    until: Math.floor(now.getTime() / 1000)
  }, connectedAccount);

  return { pageInsights };
}

// --- Main ---

(async () => {
  const now = new Date();
  const startDate = new Date(now - days * 86400000);

  console.log(`Checking analytics (last ${days} days, platform: ${platformFilter})\n`);

  // Collect all results across platforms
  const allResults = [];

  // --- TikTok Analytics ---
  if (platformFilter === 'all' || platformFilter === 'tiktok') {
    const tiktokAccount = getConnectedAccount('tiktok');

    if (tiktokAccount) {
      // 1. Fetch TikTok videos via Composio
      console.log('Fetching TikTok video list via Composio...');
      let allVideos = [];
      let cursor = undefined;

      // Paginate through all videos (most accounts have < 100 recent videos)
      while (true) {
        const toolArgs = { max_count: 20 };
        if (cursor) toolArgs.cursor = cursor;

        const result = await executeTool('TIKTOK_LIST_VIDEOS', toolArgs, tiktokAccount);
        const videos = result.videos || result.data?.videos || [];

        if (videos.length === 0) break;
        allVideos = allVideos.concat(videos);

        // Check if there are more pages
        const nextCursor = result.cursor || result.data?.cursor;
        if (!nextCursor || nextCursor === cursor) break;

        // Stop paginating once we've gone past our date range
        const oldestInBatch = videos.reduce((oldest, v) => {
          const t = typeof v.create_time === 'number' ? v.create_time * 1000 : new Date(v.create_time).getTime();
          return t < oldest ? t : oldest;
        }, Infinity);

        if (oldestInBatch < startDate.getTime()) break;

        cursor = nextCursor;
        await sleep(500);
      }

      // Filter to videos within the date range
      const videosInRange = allVideos.filter(v => {
        const t = typeof v.create_time === 'number' ? v.create_time * 1000 : new Date(v.create_time).getTime();
        return t >= startDate.getTime() && t <= now.getTime();
      });

      console.log(`  Found ${allVideos.length} total videos, ${videosInRange.length} in date range\n`);

      // 2. Load local post metadata
      const baseDir = path.dirname(configPath);
      const localPosts = loadLocalPosts(baseDir);

      // Filter to posts within the date range
      const postsInRange = localPosts.filter(p => {
        if (!p.postedAt) return false;
        const t = new Date(p.postedAt).getTime();
        return t >= startDate.getTime() && t <= now.getTime();
      });

      console.log(`  Found ${postsInRange.length} local posts in date range\n`);

      // 3. Match local posts to TikTok videos
      const matched = matchPostsToVideos(postsInRange, videosInRange);
      const unmatched = postsInRange.filter(p => !matched.find(m => m.post.dir === p.dir));

      console.log(`  Matched: ${matched.length}`);
      console.log(`  Unmatched: ${unmatched.length}`);
      if (unmatched.length > 0) {
        unmatched.forEach(p => {
          console.log(`    ? "${(p.caption || p.title || p.dir).substring(0, 50)}" (${p.postedAt || 'no date'})`);
        });
      }
      console.log('');

      // 4. Fetch per-video analytics via the proxy endpoint
      console.log('Fetching per-video analytics...\n');

      const matchedVideoIds = matched.map(m => m.video.id);
      let analyticsMap = {};

      if (matchedVideoIds.length > 0) {
        // Batch video IDs into groups of 20 (TikTok API limit)
        const batchSize = 20;
        for (let i = 0; i < matchedVideoIds.length; i += batchSize) {
          const batch = matchedVideoIds.slice(i, i + batchSize);

          try {
            const proxyResult = await executeProxy({
              endpoint: 'https://open.tiktokapis.com/v2/video/query/',
              method: 'POST',
              body: {
                filters: { video_ids: batch },
                fields: ['id', 'title', 'view_count', 'like_count', 'comment_count', 'share_count', 'create_time']
              }
            }, tiktokAccount);

            const videoData = proxyResult.videos || proxyResult.data?.videos || [];
            for (const v of videoData) {
              analyticsMap[v.id] = {
                views: v.view_count || 0,
                likes: v.like_count || 0,
                comments: v.comment_count || 0,
                shares: v.share_count || 0
              };
            }
          } catch (err) {
            console.log(`  Warning: analytics batch failed: ${err.message}`);
          }

          if (i + batchSize < matchedVideoIds.length) await sleep(500);
        }
      }

      // 5. Build TikTok results and display
      console.log('TikTok Per-Video Analytics:\n');

      for (const { post, video, matchType } of matched) {
        const videoTime = typeof video.create_time === 'number'
          ? new Date(video.create_time * 1000)
          : new Date(video.create_time);

        const metrics = analyticsMap[video.id] || { views: 0, likes: 0, comments: 0, shares: 0 };
        const hook = (post.caption || post.title || post.dir).substring(0, 60);

        const result = {
          dir: post.dir,
          postId: post.postId || null,
          videoId: video.id,
          videoUrl: video.share_url || null,
          date: videoTime.toISOString().slice(0, 10),
          postedAt: post.postedAt,
          hook,
          matchType,
          platform: 'tiktok',
          views: metrics.views,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares
        };
        allResults.push(result);

        const viewStr = result.views > 1000 ? `${(result.views / 1000).toFixed(1)}K` : result.views;
        console.log(`  ${result.date} | ${viewStr} views | ${result.likes} likes | ${result.comments} comments | ${result.shares} shares`);
        console.log(`    "${result.hook}..."`);
        console.log(`    Video: ${result.videoId} (matched by ${matchType})\n`);
      }

      // Also include unmatched TikTok videos that have no local post counterpart
      const unmatchedVideos = videosInRange.filter(v => !matchedVideoIds.includes(v.id));
      if (unmatchedVideos.length > 0) {
        console.log(`  (${unmatchedVideos.length} TikTok videos in range had no matching local post)\n`);
      }
    } else {
      console.log('  Skipping TikTok: no connected account configured\n');
    }
  }

  // --- Instagram Analytics ---
  if ((platformFilter === 'all' || platformFilter === 'instagram') && getConnectedAccount('instagram')) {
    const igResults = await fetchInstagramAnalytics();
    if (igResults) {
      console.log('\nInstagram Analytics:\n');
      for (const p of igResults.posts) {
        console.log(`  ${p.timestamp?.slice(0, 10)} | ${p.reach || 0} reach | ${p.likes || 0} likes | "${p.caption}..."`);
      }
      allResults.push(...igResults.posts);
    }
  }

  // --- Facebook Analytics ---
  if ((platformFilter === 'all' || platformFilter === 'facebook') && getConnectedAccount('facebook')) {
    const fbResults = await fetchFacebookAnalytics(startDate, now);
    if (fbResults) {
      console.log('\nFacebook Page Insights fetched');
    }
  }

  // 6. Save analytics snapshot
  const baseDir = path.dirname(configPath);
  const analyticsPath = path.join(baseDir, 'analytics-snapshot.json');
  const snapshot = {
    date: now.toISOString(),
    days,
    platform: platformFilter,
    totalResults: allResults.length,
    posts: allResults
  };
  fs.writeFileSync(analyticsPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSaved analytics snapshot to ${analyticsPath}`);

  // 7. Summary with per-platform totals
  console.log('\nSummary:');

  // Gather distinct platforms present in results
  const platforms = [...new Set(allResults.map(r => r.platform).filter(Boolean))];

  if (platforms.length > 1 || platformFilter === 'all') {
    // Show per-platform breakdown
    for (const plat of platforms) {
      const platResults = allResults.filter(r => r.platform === plat);
      const totalViews = platResults.reduce((s, r) => s + (r.views || 0), 0);
      const totalLikes = platResults.reduce((s, r) => s + (r.likes || 0), 0);
      const totalComments = platResults.reduce((s, r) => s + (r.comments || 0), 0);
      const totalShares = platResults.reduce((s, r) => s + (r.shares || 0), 0);

      console.log(`\n  [${plat.toUpperCase()}]`);
      console.log(`    Posts tracked: ${platResults.length}`);
      console.log(`    Total views: ${totalViews.toLocaleString()}`);
      console.log(`    Total likes: ${totalLikes.toLocaleString()}`);
      console.log(`    Total comments: ${totalComments.toLocaleString()}`);
      console.log(`    Total shares: ${totalShares.toLocaleString()}`);

      if (platResults.length > 0 && platResults.some(r => r.views !== undefined)) {
        const best = platResults.reduce((a, b) => (a.views || 0) > (b.views || 0) ? a : b);
        const worst = platResults.reduce((a, b) => (a.views || 0) < (b.views || 0) ? a : b);
        const bestLabel = best.hook || best.caption || best.id || '';
        const worstLabel = worst.hook || worst.caption || worst.id || '';
        console.log(`    Best:  ${(best.views || 0).toLocaleString()} views -- "${bestLabel}..."`);
        console.log(`    Worst: ${(worst.views || 0).toLocaleString()} views -- "${worstLabel}..."`);
      }
    }
  }

  // Show aggregate totals
  const totalViews = allResults.reduce((s, r) => s + (r.views || 0), 0);
  const totalLikes = allResults.reduce((s, r) => s + (r.likes || 0), 0);
  const totalComments = allResults.reduce((s, r) => s + (r.comments || 0), 0);
  const totalShares = allResults.reduce((s, r) => s + (r.shares || 0), 0);

  console.log('\n  [AGGREGATE]');
  console.log(`    Total views: ${totalViews.toLocaleString()}`);
  console.log(`    Total likes: ${totalLikes.toLocaleString()}`);
  console.log(`    Total comments: ${totalComments.toLocaleString()}`);
  console.log(`    Total shares: ${totalShares.toLocaleString()}`);
  console.log(`    Posts tracked: ${allResults.length}`);

  if (allResults.length > 0 && allResults.some(r => r.views !== undefined)) {
    const best = allResults.reduce((a, b) => (a.views || 0) > (b.views || 0) ? a : b);
    const worst = allResults.reduce((a, b) => (a.views || 0) < (b.views || 0) ? a : b);
    const bestLabel = best.hook || best.caption || best.id || '';
    const worstLabel = worst.hook || worst.caption || worst.id || '';
    console.log(`    Best:  ${(best.views || 0).toLocaleString()} views -- "${bestLabel}..."`);
    console.log(`    Worst: ${(worst.views || 0).toLocaleString()} views -- "${worstLabel}..."`);
  }
})();
