#!/usr/bin/env node
/**
 * Self-Improvement Engine - Part of the "Notary Book" system
 * Analyzes performance data and updates strategy based on real results.
 * Learns best posting times and hooks.
 */

const fs = require('fs');
const path = require('path');

const configPath = process.argv[2] || `${process.env.HOME}/social-marketing/config.json`;
const configDir = path.dirname(path.resolve(configPath));

const perfPath = path.join(configDir, 'hook-performance.json');
const strategyPath = path.join(configDir, 'strategy.json');

if (!fs.existsSync(perfPath)) {
  console.log('⚠️  No performance data yet. Skipping self-improvement.');
  process.exit(0);
}

const performance = JSON.parse(fs.readFileSync(perfPath, 'utf-8'));
const strategy = fs.existsSync(strategyPath) 
  ? JSON.parse(fs.readFileSync(strategyPath, 'utf-8')) 
  : { postingTimes: [], activeHooks: [], updatedAt: new Date().toISOString() };

console.log(`📊 Analyzing ${performance.length} posts...`);

// Analyze by posting time
const timeStats = {};
performance.forEach(p => {
  const time = (p.time || p.postTime || '11:00').substring(0,5);
  const views = p.reach || p.views || p.impressions || 0;
  if (!timeStats[time]) timeStats[time] = { count: 0, totalViews: 0 };
  timeStats[time].count++;
  timeStats[time].totalViews += views;
});

strategy.postingTimes = Object.keys(timeStats).map(time => ({
  time,
  avgViews: Math.round(timeStats[time].totalViews / timeStats[time].count),
  count: timeStats[time].count,
  priority: timeStats[time].avgViews > 8000 ? 1 : 2
})).sort((a, b) => b.avgViews - a.avgViews);

strategy.updatedAt = new Date().toISOString();

fs.writeFileSync(strategyPath, JSON.stringify(strategy, null, 2));

console.log('✅ Self-improvement completed');
console.log('Best times:', strategy.postingTimes.slice(0,3).map(t => `${t.time} (${t.avgViews} avg views)`));

process.exit(0);