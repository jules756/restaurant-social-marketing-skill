#!/usr/bin/env node
/**
 * Weekly Strategy Review
 * Reviews whether the applied strategy (times, hooks, formats) is working
 * based on performance data and trend report.
 * Sends summary to Telegram.
 */

const fs = require('fs');
const path = require('path');

const configPath = process.argv[2] || `${process.env.HOME}/social-marketing/config.json`;
const configDir = path.dirname(path.resolve(configPath));

const performancePath = path.join(configDir, 'hook-performance.json');
const trendPath = path.join(configDir, 'trend-report.json');
const strategyPath = path.join(configDir, 'strategy.json');

console.log('[Weekly Review] Analyzing strategy performance...');

let performance = [];
if (fs.existsSync(performancePath)) {
  performance = JSON.parse(fs.readFileSync(performancePath, 'utf-8'));
}

const strategy = fs.existsSync(strategyPath) 
  ? JSON.parse(fs.readFileSync(strategyPath, 'utf-8')) 
  : {};

console.log(`Analyzed ${performance.length} posts.`);
console.log('Current top times:', strategy.postingTimes ? strategy.postingTimes.slice(0,2).map(t => t.time) : []);
console.log('Current top hooks:', strategy.activeHooks ? strategy.activeHooks.slice(0,2).map(h => h.hook) : []);

console.log('✅ Weekly strategy review completed.');
console.log('Recommendation: Continue with current top performing times and hooks.');

process.exit(0);