# Booking System Integration

## Overview

This skill tracks restaurant bookings to close the feedback loop. Instead of optimizing for views (vanity metrics), we optimize for actual bums in seats.

## Supported Tracking Methods

### 1. Manual Tracking (Default)

The simplest method. The agent asks the user each morning:

> "How many bookings/reservations did you have yesterday? And roughly how many covers (diners)?"

Data is stored in `tiktok-marketing/bookings.json`:

```json
{
  "entries": [
    {
      "date": "2026-04-07",
      "bookings": 52,
      "covers": 120,
      "source": "manual"
    }
  ],
  "baseline": {
    "avgDailyBookings": 45,
    "avgDailyCovers": 100,
    "measurementPeriod": "2026-03-01 to 2026-03-31"
  }
}
```

Config:
```json
{
  "bookingTracking": {
    "method": "manual",
    "platform": "manual",
    "dailyBaseline": 45
  }
}
```

### 2. UTM Link Tracking

If the restaurant has a website with booking functionality and Google Analytics:

1. Set up a UTM link for the TikTok bio:
   ```
   https://restaurant.com/book?utm_source=tiktok&utm_medium=social&utm_campaign=slideshow
   ```

2. Track in Google Analytics:
   - Sessions from `utm_source=tiktok`
   - Booking page visits
   - Booking completions (set up as a conversion goal)

3. The agent can pull this data via the Google Analytics API (if connected) or ask for a daily summary.

Config:
```json
{
  "bookingTracking": {
    "method": "utm",
    "platform": "google-analytics",
    "utmLink": "https://restaurant.com/book?utm_source=tiktok&utm_medium=social",
    "dailyBaseline": 45
  }
}
```

### 3. Booking Platform API

If the restaurant uses a platform with API access:

**OpenTable:**
- Partner API available for restaurants with OpenTable accounts
- Can pull reservation counts programmatically
- Agent should research the specific API endpoints

**Resy:**
- API available for restaurant partners
- Can pull booking data and cover counts

**TheFork (TripAdvisor):**
- Partner API for affiliated restaurants
- Reservation data available

**Square / Toast / Clover (POS systems):**
- These POS systems have APIs that track covers and revenue
- Can provide more granular data than booking platforms alone

Config:
```json
{
  "bookingTracking": {
    "method": "api",
    "platform": "opentable",
    "apiKey": "...",
    "restaurantId": "...",
    "dailyBaseline": 45
  }
}
```

## Setting Up the Baseline

**CRITICAL:** Before starting to post, record the restaurant's average daily bookings. This is the "before" number.

Ask the user:

> "Before we start posting, I need to know your current booking numbers so we can measure the impact. Over the last month or so, how many bookings do you average per day? And roughly how many covers (total diners) per day?"

Store as `baseline` in bookings.json. This baseline makes the daily report meaningful — without it, you can't tell if bookings went up because of TikTok or because of seasonality/weather/events.

## What Booking Data Unlocks

### Per-Post Attribution
The daily report cross-references booking spikes with post timing:
- Posts published -> 24-72h later -> booking spike -> likely correlation
- Track which hooks consistently precede booking increases

### Diagnostic Intelligence
- **High views + More bookings** -> Marketing is working. Scale it.
- **High views + Same bookings** -> Hook works but CTA/booking page is broken. Fix downstream.
- **Low views + More bookings** -> Content converts but needs more eyeballs. Fix hooks.
- **Low views + Same bookings** -> Nothing is working. Full reset.

### Systemic Issues
If bookings increase but negative reviews also increase:
- Restaurant may be exceeding capacity
- Kitchen may not be keeping up with demand
- Service quality may be dropping under pressure
- **Signal to pause scaling and fix the experience**

## Daily Check-In

The agent should check in with the user each morning (before generating the daily report):

> "Morning! Quick check — how many bookings yesterday? Any walk-ins mentioning TikTok?"

This conversational approach is often more accurate than API data alone, because it captures:
- Walk-ins who mentioned seeing the restaurant on TikTok
- Phone bookings triggered by TikTok content
- General foot traffic changes that correlate with viral posts
