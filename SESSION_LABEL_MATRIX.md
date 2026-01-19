# Session Label Matrix

This document contains all session labels organized by category for both playtime and achievement sessions. Edit out any labels you don't like before creating badges.

## Playtime Session Labels

### Category: Ultra Marathon (> 8 hours)
- Absolute Legend
- No Life Mode
- Unstoppable
- The Commitment

### Category: Marathon (> 5 hours in single day)
- Marathon Session
- Epic Run
- Built Different
- No Cap Session

### Category: High Intensity (> 70% of window, < 80%)
- Total Grindset
- In the Zone
- Locked In
- Fully Committed
- All In

### Category: Zero Life Mode (> 80% intensity)
- Zero Life Mode
- No Distractions
- Fully Locked In

### Category: Long Window (7+ days)
- The Recap
- Slow Burn
- The Comeback
- Back at It
- The Return

### Category: Steady Progress (2-4 hours in 24h window)
- Putting the Hours In
- The Usual
- Daily Dose
- Regular Grind
- The Routine

### Category: Casual (< 30% intensity, but > 1 hour played)
- Casual Vibes
- Taking It Slow
- Chill Session
- Easy Does It
- Relaxed Mode

### Category: Micro Session (< 15 min, high intensity)
- Quick Fix
- Speedrun Attempt
- Blink and Miss
- Lightning Round

### Category: Short & Punchy (< 30 min)
- Quick Sesh
- Pop In
- Quick Run
- Warm Up
- Touch Base
- Quick Check

---

## Achievement Session Labels

### Category: Single Achievement
- Achievement Unlocked
- Got One
- New Trophy
- Unlocked

### Category: Multiple Achievements (2-4)
- Achievement Spree
- Unlock Streak
- Trophy Run
- Collection Session
- Unlock Binge

### Category: Many Achievements (5+)
- Achievement Hunt
- Unlock Marathon
- Trophy Haul
- Achievement Rush
- Unlock Spree

### Category: Rare Achievement (Legendary/Epic, single)
- Rare Find
- Legendary Unlock
- Epic Achievement
- Rare Trophy
- Legendary Moment

### Category: Multiple Rare Achievements (Legendary/Epic, 2+)
- Rare Collection
- Legendary Streak
- Epic Run
- Rare Haul

---

## Decision Logic

### Playtime Sessions
1. **Ultra Marathon**: `playtimeDeltaMinutes >= 480`
2. **Marathon**: `playtimeDeltaMinutes >= 300 && windowDays < 1`
3. **Zero Life Mode**: `intensity >= 0.8`
4. **High Intensity**: `intensity >= 0.7 && intensity < 0.8`
5. **Long Window**: `windowDays >= 7`
6. **Steady Progress**: `playtimeDeltaMinutes >= 120 && playtimeDeltaMinutes <= 240 && windowDays < 1.5`
7. **Casual**: `intensity < 0.3 && playtimeDeltaMinutes >= 60`
8. **Micro Session**: `playtimeDeltaMinutes < 15 && intensity >= 0.5`
9. **Short & Punchy**: `playtimeDeltaMinutes < 30` (fallback)

### Achievement Sessions
1. **Multiple Rare**: `isRare && achievementCount > 1`
2. **Rare**: `isRare && achievementCount === 1`
3. **Many**: `achievementCount >= 5`
4. **Multiple**: `achievementCount > 1 && achievementCount < 5`
5. **Single**: `achievementCount === 1` (fallback)

---

## Notes

- Labels are selected randomly from their category pool
- Each session gets one label based on the decision logic above
- Subtext is generated separately (e.g., "Played 2h 30m in the last 4 hours" or "3 unlocks")
- Rarity is determined by `minRarity === 'legendary' || minRarity === 'epic' || minRarityPercentage < 5`
