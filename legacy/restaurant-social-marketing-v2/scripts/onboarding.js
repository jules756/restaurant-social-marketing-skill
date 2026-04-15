#!/usr/bin/env node
/**
 * TikTok Restaurant Marketing — Onboarding Config Validator
 *
 * The onboarding is CONVERSATIONAL — the agent talks to the user naturally,
 * not through this script. This script validates the resulting config is complete.
 *
 * Usage:
 *   node onboarding.js --validate --config tiktok-marketing/config.json
 *   node onboarding.js --init --dir tiktok-marketing/
 *
 * --validate: Check config completeness, show what's missing
 * --init: Create the directory structure and empty config files
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : null;
const validate = args.includes('--validate');
const init = args.includes('--init');
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'tiktok-marketing';

if (init) {
  // Create directory structure
  const dirs = [dir, `${dir}/posts`, `${dir}/hooks`, `${dir}/bookings`, `${dir}/knowledge-base`, `${dir}/photos`];
  dirs.forEach(d => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      console.log(`📁 Created ${d}/`);
    }
  });

  // Empty config template
  const configTemplate = {
    restaurant: {
      name: '',
      cuisine: '',
      description: '',
      audience: '',
      vibe: '',
      differentiator: '',
      signatureDishes: [],
      bookingUrl: '',
      location: '',
      priceRange: ''
    },
    imageGen: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-image-1.5'
    },
    composio: {
      apiKey: '',
      connectedAccounts: {
        tiktok: '',
        instagram: '',
        facebook: '',
        googledrive: ''
      },
      userId: ''
    },
    bookingTracking: {
      method: '',
      platform: '',
      dailyBaseline: 0
    },
    platforms: {
      tiktok: { enabled: true, dimensions: '1024x1536', slides: 6 },
      instagram: { enabled: false, postTypes: ['feed', 'reels'], feedDimensions: '1080x1350' },
      facebook: { enabled: false, pageId: '', feedDimensions: '1200x630' }
    },
    knowledgeBase: {
      dir: `${dir}/knowledge-base`,
      menu: `${dir}/knowledge-base/menu.json`,
      history: `${dir}/knowledge-base/history.json`,
      chef: `${dir}/knowledge-base/chef.json`,
      recipes: `${dir}/knowledge-base/recipes.json`
    },
    googleDrive: {
      enabled: false,
      folderId: '',
      localCachePath: `${dir}/photos/`
    },
    posting: {
      privacyLevel: 'SELF_ONLY',
      schedule: ['11:00', '17:00', '20:30'],
      platformSchedule: {
        tiktok: ['11:00', '17:00', '20:30'],
        instagram: ['12:00', '18:00'],
        facebook: ['10:00', '17:00']
      }
    },
    competitors: `${dir}/competitor-research.json`,
    strategy: `${dir}/strategy.json`
  };

  const cfgPath = `${dir}/config.json`;
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, JSON.stringify(configTemplate, null, 2));
    console.log(`📝 Created ${cfgPath}`);
  }

  // Empty competitor research template
  const compPath = `${dir}/competitor-research.json`;
  if (!fs.existsSync(compPath)) {
    fs.writeFileSync(compPath, JSON.stringify({
      researchDate: '',
      competitors: [],
      nicheInsights: {
        trendingSounds: [],
        commonFormats: [],
        gapOpportunities: '',
        avoidPatterns: ''
      }
    }, null, 2));
    console.log(`📝 Created ${compPath}`);
  }

  // Empty strategy template
  const stratPath = `${dir}/strategy.json`;
  if (!fs.existsSync(stratPath)) {
    fs.writeFileSync(stratPath, JSON.stringify({
      hooks: [],
      postingSchedule: ['11:00', '17:00', '20:30'],
      hookCategories: { testing: [], proven: [], dropped: [] },
      crossPostPlatforms: [],
      notes: ''
    }, null, 2));
    console.log(`📝 Created ${stratPath}`);
  }

  // Empty hook performance tracker
  const hookPath = `${dir}/hook-performance.json`;
  if (!fs.existsSync(hookPath)) {
    fs.writeFileSync(hookPath, JSON.stringify({
      hooks: [],
      rules: { doubleDown: [], testing: [], dropped: [] }
    }, null, 2));
    console.log(`📝 Created ${hookPath}`);
  }

  // Bookings tracking template
  const bookingsPath = `${dir}/bookings/bookings.json`;
  if (!fs.existsSync(bookingsPath)) {
    fs.writeFileSync(bookingsPath, JSON.stringify({
      trackingStartDate: '',
      dailyBaseline: 0,
      method: '',
      platform: '',
      entries: [],
      notes: ''
    }, null, 2));
    console.log(`📝 Created ${bookingsPath}`);
  }

  // Knowledge base templates (created via knowledge-base.js --init)
  const kbDir = `${dir}/knowledge-base`;
  if (!fs.existsSync(kbDir)) {
    // The knowledge-base.js script handles detailed template creation
    // Just ensure the directory exists here
    fs.mkdirSync(kbDir, { recursive: true });
    console.log(`📁 Created ${kbDir}/`);
  }

  // Promotions template
  const promoPath = `${dir}/promotions.json`;
  if (!fs.existsSync(promoPath)) {
    fs.writeFileSync(promoPath, JSON.stringify({ promotions: [] }, null, 2));
    console.log(`📝 Created ${promoPath}`);
  }

  console.log('\n✅ Directory structure ready. Start the conversational onboarding to fill in config.');
  process.exit(0);
}

if (validate && configPath) {
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const required = [];
  const optional = [];

  // Restaurant profile (required)
  if (!config.restaurant?.name) required.push('restaurant.name — What\'s the restaurant called?');
  if (!config.restaurant?.cuisine) required.push('restaurant.cuisine — What kind of food?');
  if (!config.restaurant?.description) required.push('restaurant.description — What\'s it about?');
  if (!config.restaurant?.audience) required.push('restaurant.audience — Who are the target diners?');

  // Image generation (required)
  if (!config.imageGen?.provider) required.push('imageGen.provider — Which image tool?');
  if (config.imageGen?.provider && config.imageGen.provider !== 'local' && !config.imageGen?.apiKey) {
    required.push('imageGen.apiKey — API key for image generation');
  }

  // Composio (required)
  if (!config.composio?.apiKey) required.push('composio.apiKey — Composio API key');
  if (!config.composio?.connectedAccounts?.tiktok) required.push('composio.connectedAccounts.tiktok — TikTok connected account ID');

  // Platform-specific Composio account checks (optional)
  if (config.platforms?.instagram?.enabled && !config.composio?.connectedAccounts?.instagram) {
    optional.push('Instagram enabled but no Composio connected account — add composio.connectedAccounts.instagram');
  }
  if (config.platforms?.facebook?.enabled && !config.composio?.connectedAccounts?.facebook) {
    optional.push('Facebook enabled but no Composio connected account — add composio.connectedAccounts.facebook');
  }
  if (config.googleDrive?.enabled && !config.composio?.connectedAccounts?.googledrive) {
    optional.push('Google Drive enabled but no Composio connected account — add composio.connectedAccounts.googledrive');
  }

  // Knowledge base checks (optional)
  if (!config.knowledgeBase?.dir || !fs.existsSync(config.knowledgeBase.dir)) {
    optional.push('Knowledge base not initialized');
  } else {
    // Check if menu.json has items
    const menuPath = config.knowledgeBase.menu || path.join(config.knowledgeBase.dir, 'menu.json');
    if (fs.existsSync(menuPath)) {
      try {
        const menu = JSON.parse(fs.readFileSync(menuPath, 'utf-8'));
        const items = menu.dishes || menu.items || menu.menu || [];
        if (Array.isArray(items) && items.length === 0) {
          optional.push('Menu is empty — add dishes for better content');
        }
      } catch (e) {
        // menu.json exists but isn't valid JSON yet
      }
    }
  }

  // Competitor research (important but not blocking)
  const compResearchPath = config.competitors;
  if (compResearchPath && fs.existsSync(compResearchPath)) {
    const comp = JSON.parse(fs.readFileSync(compResearchPath, 'utf-8'));
    if (!comp.competitors || comp.competitors.length === 0) {
      optional.push('Competitor research — no competitors analyzed yet (run browser research)');
    }
  } else {
    optional.push('Competitor research — file not created yet');
  }

  // Strategy
  const strategyPath = config.strategy;
  if (strategyPath && fs.existsSync(strategyPath)) {
    const strat = JSON.parse(fs.readFileSync(strategyPath, 'utf-8'));
    if (!strat.hooks || strat.hooks.length === 0) {
      optional.push('Content strategy — no hooks planned yet');
    }
  } else {
    optional.push('Content strategy — file not created yet');
  }

  // Booking tracking (optional but recommended for restaurants)
  if (!config.bookingTracking?.method) {
    optional.push('Booking tracking — not configured yet (recommended for measuring TikTok-driven reservations)');
  }

  // Booking URL
  if (!config.restaurant?.bookingUrl) optional.push('Booking URL — helpful for driving reservations from TikTok');

  // Results
  if (required.length === 0) {
    console.log('✅ Core config complete! Ready to start posting.\n');
  } else {
    console.log('❌ Missing required config:\n');
    required.forEach(r => console.log(`   ⬚ ${r}`));
    console.log('');
  }

  if (optional.length > 0) {
    console.log('💡 Recommended (not blocking):\n');
    optional.forEach(o => console.log(`   ○ ${o}`));
    console.log('');
  }

  // Summary
  console.log('📋 Setup Summary:');
  console.log(`   Restaurant: ${config.restaurant?.name || '(not set)'}`);
  console.log(`   Cuisine: ${config.restaurant?.cuisine || '(not set)'}`);
  console.log(`   Location: ${config.restaurant?.location || '(not set)'}`);
  console.log(`   Price Range: ${config.restaurant?.priceRange || '(not set)'}`);
  console.log(`   Image Gen: ${config.imageGen?.provider || '(not set)'}${config.imageGen?.model ? ` (${config.imageGen.model})` : ''}`);
  console.log(`   TikTok: ${config.composio?.connectedAccounts?.tiktok ? 'Connected via Composio' : 'Not connected'}`);

  // Platforms summary
  const enabledPlatforms = [];
  if (config.platforms?.tiktok?.enabled) enabledPlatforms.push('TikTok');
  if (config.platforms?.instagram?.enabled) enabledPlatforms.push('Instagram');
  if (config.platforms?.facebook?.enabled) enabledPlatforms.push('Facebook');
  console.log(`   Platforms: ${enabledPlatforms.length > 0 ? enabledPlatforms.join(', ') : '(none enabled)'}`);

  // Knowledge base summary
  if (config.knowledgeBase?.dir && fs.existsSync(config.knowledgeBase.dir)) {
    let dishCount = 0;
    let recipeCount = 0;
    const kbMenuPath = config.knowledgeBase.menu || path.join(config.knowledgeBase.dir, 'menu.json');
    const kbRecipesPath = config.knowledgeBase.recipes || path.join(config.knowledgeBase.dir, 'recipes.json');
    if (fs.existsSync(kbMenuPath)) {
      try {
        const menu = JSON.parse(fs.readFileSync(kbMenuPath, 'utf-8'));
        const items = menu.dishes || menu.items || menu.menu || [];
        if (Array.isArray(items)) dishCount = items.length;
      } catch (e) { /* ignore */ }
    }
    if (fs.existsSync(kbRecipesPath)) {
      try {
        const recipes = JSON.parse(fs.readFileSync(kbRecipesPath, 'utf-8'));
        const items = recipes.recipes || recipes.items || [];
        if (Array.isArray(items)) recipeCount = items.length;
      } catch (e) { /* ignore */ }
    }
    console.log(`   Knowledge Base: ${dishCount} dishes, ${recipeCount} recipes`);
  } else {
    console.log('   Knowledge Base: Not initialized');
  }

  // Google Drive summary
  if (config.googleDrive?.enabled && config.composio?.connectedAccounts?.googledrive) {
    console.log('   Google Drive: Connected');
  } else {
    console.log('   Google Drive: Not configured');
  }

  // Promotions summary
  const configDir = path.dirname(configPath);
  const promosPath = path.join(configDir, 'promotions.json');
  let activePromos = 0;
  if (fs.existsSync(promosPath)) {
    try {
      const promos = JSON.parse(fs.readFileSync(promosPath, 'utf-8'));
      const promoList = promos.promotions || [];
      if (Array.isArray(promoList)) activePromos = promoList.length;
    } catch (e) { /* ignore */ }
  }
  console.log(`   Active Promotions: ${activePromos}`);

  if (config.bookingTracking?.method) console.log(`   Booking Tracking: ${config.bookingTracking.method} (${config.bookingTracking.platform || 'no platform set'})`);

  console.log(`   Privacy: ${config.posting?.privacyLevel || 'SELF_ONLY'}`);
  console.log(`   Schedule: ${(config.posting?.schedule || []).join(', ')}`);

  process.exit(required.length > 0 ? 1 : 0);
} else {
  console.log('Usage:');
  console.log('  node onboarding.js --init --dir tiktok-marketing/    Create directory structure');
  console.log('  node onboarding.js --validate --config config.json    Validate config completeness');
}
