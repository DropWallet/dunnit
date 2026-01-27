# Session Label Matrix

This document contains all session labels organized by category for both playtime and achievement sessions. Edit out any labels you don't like before creating badges.

## Playtime Session Labels

### Category: Ultra Marathon (> 8 hours)
- Absolute legend
- RSI king
- Ultra marathon
- Total commitment

### Category: Marathon (> 5 hours in single day)
- Marathon Session
- Staying power
- Retina's singed
- Iron bladder

### Category: High Intensity (> 70% of window, < 80%)
- Grindset mindset
- In the zone
- Locked in
- Fully committed
- All in

### Category: Zero Life Mode (> 80% intensity)
- Zero Life Mode
- No Distractions
- Fully Locked In

### Category: Long Window (7+ days)
- Slow burn
- The comeback
- Back at it
- The return

### Category: Steady Progress (2-4 hours in 24h window)
- Putting the hours in
- The usual
- Daily dose
- Regular grind
- The routine

### Category: Casual (< 30% intensity, but > 1 hour played)
- Casual vibes
- Taking it slow
- Chill session
- Easy does it
- Relaxed mode

### Category: Micro Session (< 15 min, high intensity)
- Quick fix
- Speedrun
- Blink and miss
- Lightning round

### Category: Short & Punchy (< 30 min)
- Quick sesh
- Pop in
- Quick run
- Warm up
- Touch base
- Quick check

---

## Achievement Session Labels

### Category: Single Achievement
- Achievement unlocked
- Got one
- New trophy
- Nailed it

### Category: Multiple Achievements (2-4)
- Achievement spree
- Unlock streak
- Trophy run
- Collection session
- Unlock binge

### Category: Many Achievements (5+)
- Achievement hunt
- Unlock marathon
- Trophy haul
- Achievement rush
- Unlock spree

### Category: Rare Achievement (Legendary/Epic, single)
- Rare find
- Legendary unlock
- Epic achievement
- Rare trophy
- Legendary moment

### Category: Multiple Rare Achievements (Legendary/Epic, 2+)
- Rare collection
- Legendary streak
- Epic run
- Rare haul

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
