# Dunnit - Strava for Steam

A social gaming activity tracker that automatically records your Steam gaming sessions, achievements, and progress—similar to how Strava tracks fitness activities. Built with Next.js, Tailwind CSS, and Steam API integration.

## 🎯 Vision

Transform Steam gaming into a social, trackable experience where players can:
- Automatically track gaming sessions
- Share achievements and milestones
- Follow friends' gaming activities
- Compete and celebrate gaming achievements together

## 📊 Current Status

### ✅ Completed (Phase 1 - In Progress)

- **Steam Authentication**: OpenID integration with Steam
- **Dashboard**: User profile, statistics, and game library display
- **Game Detail Pages**: Individual game pages with achievement tracking
- **Achievement System**: 
  - Achievement cards with rarity badges
  - Global achievement percentages
  - Unlock timestamps
  - Hidden achievement descriptions (via XML API fallback)
- **Image Fallbacks**: Robust image loading with multiple fallback options
- **Design System**: Semantic token system with light/dark mode support

### 🚧 In Progress

- **Session Persistence**: Currently using in-memory store (needs Supabase integration)
- **UI Polish**: Finalizing dashboard and game page layouts

### 📋 Next Up

See [Development Roadmap](#-development-roadmap) below for the complete plan.

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with semantic design tokens
- **UI Components**: shadcn/ui
- **Theme**: Automatic light/dark mode with CSS variables
- **Language**: TypeScript
- **Authentication**: Steam OpenID
- **APIs**: Steam Web API, Steam Store API, Steam Legacy XML API
- **Deployment**: Vercel

## 🎨 Design System

### Token Architecture

The project uses a semantic token system with CSS custom properties:

- **Semantic tokens**: `primary`, `secondary`, `background`, `foreground`, `surface-low`, `surface-mid`, `text-strong`, `text-moderate`, `text-subdued`, etc.
- **Raw color tokens**: Stored as HSL values in CSS variables
- **Automatic theming**: Light/dark mode swaps token values automatically
- **Rarity tokens**: `rarity-common`, `rarity-uncommon`, `rarity-rare`, `rarity-legendary`

### Token Structure

Tokens are defined in `app/globals.css`:
- `:root` - Light mode tokens
- `.dark` - Dark mode tokens

Tailwind classes use semantic names:
- `bg-primary`, `text-foreground`, `border-border-strong`, `bg-surface-low`, etc.

### Customizing Tokens

Update the HSL values in `app/globals.css` to match your design:

```css
:root {
  --primary: 221.2 83.2% 53.3%; /* HSL values without hsl() wrapper */
  --primary-foreground: 210 40% 98%;
  /* ... */
}
```

## 🚀 Getting Started

1. **Install dependencies:**
```bash
npm install
```

2. **Set up Supabase:**
   - Create a project at [supabase.com](https://supabase.com)
   - Go to Settings → API and copy your credentials
   - Go to SQL Editor and run the SQL from `supabase-schema.sql`

3. **Set up environment variables:**
   Create a `.env.local` file in the root directory:
```env
# Steam API Configuration
STEAM_API_KEY=your_steam_api_key_here

# NextAuth URL (for production, set this in Vercel)
NEXTAUTH_URL=http://localhost:3000

# Supabase Configuration
# Get these from your Supabase project: Settings -> API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

4. **Run the development server:**
```bash
npm run dev
```

5. **Open [http://localhost:3000](http://localhost:3000)** in your browser.

## 📁 Project Structure

```
dunnit/
├── app/
│   ├── api/                    # API routes
│   │   ├── achievements/       # Achievement data endpoints
│   │   ├── auth/               # Steam authentication
│   │   ├── games/              # Game data endpoints
│   │   └── user/                # User data endpoints
│   ├── dashboard/              # User dashboard page
│   ├── games/[appId]/          # Game detail pages
│   ├── globals.css             # Design tokens and global styles
│   └── layout.tsx               # Root layout with theme provider
├── components/
│   ├── ui/                     # shadcn/ui components
│   ├── achievement-card.tsx    # Achievement display component
│   ├── game-card.tsx           # Game card component
│   ├── navbar.tsx              # Navigation component
│   └── theme-provider.tsx      # Theme context provider
├── lib/
│   ├── data/                   # Data access layer
│   │   ├── access.ts           # Data access interface
│   │   └── types.ts            # Type definitions
│   ├── steam/                  # Steam API integration
│   │   ├── client.ts           # Steam API client
│   │   └── types.ts            # Steam API types
│   └── utils/                  # Utility functions
│       ├── achievements.ts     # Achievement utilities
│       ├── country.ts          # Country utilities
│       └── statistics.ts      # Statistics calculations
└── tailwind.config.ts          # Tailwind configuration
```

## 🗺 Development Roadmap

### Phase 1: Complete Current Dashboard & Game Pages ⏳

**Goal**: Finish the initial dashboard and game detail pages before moving to session tracking.

#### Step 1.1: Fix Session Persistence
- [ ] Set up Supabase project
- [ ] Create database schema (users, games, achievements tables)
- [ ] Replace `InMemoryDataAccess` with `SupabaseDataAccess`
- [ ] Test authentication and session persistence
- [ ] Deploy and verify on Vercel

#### Step 1.2: Polish Dashboard
- [ ] Fix any remaining UI issues
- [ ] Ensure all stats display correctly
- [ ] Test responsive design on all breakpoints
- [ ] Add proper loading states and error handling
- [ ] Optimize image loading performance

#### Step 1.3: Polish Game Detail Page
- [ ] Ensure all achievement data displays correctly
- [ ] Test image loading and fallbacks
- [ ] Verify rarity badges work for all achievement types
- [ ] Add loading states and error boundaries
- [ ] Test with games that have no achievements

#### Step 1.4: Testing & Cleanup
- [ ] Test full user flow (login → dashboard → game page)
- [ ] Remove any debug code
- [ ] Optimize API calls and reduce redundant requests
- [ ] Performance testing and optimization
- [ ] Accessibility audit

---

### Phase 2: Foundation for Session Tracking

**Goal**: Set up the database and basic infrastructure for tracking gaming sessions.

#### Step 2.1: Database Schema for Sessions
- [ ] Create `user_snapshots` table
  - Fields: `id`, `user_id`, `game_id`, `timestamp`, `playtime_minutes`, `achievement_count`
- [ ] Create `sessions` table
  - Fields: `id`, `user_id`, `game_id`, `start_time`, `end_time`, `playtime_delta`, `achievements_unlocked`
- [ ] Create `session_achievements` table
  - Fields: `id`, `session_id`, `achievement_id`, `unlocked_at`
- [ ] Add indexes for performance

#### Step 2.2: Snapshot Service (Basic)
- [ ] Create `lib/services/snapshot.ts`
- [ ] Function to capture current playtime for a game
- [ ] Function to capture current achievement list
- [ ] Store snapshot in database
- [ ] Add error handling and logging

#### Step 2.3: Manual Session Test
- [ ] Add "Take Snapshot" button to game page (dev only)
- [ ] Test snapshot creation
- [ ] Verify data is stored correctly in database
- [ ] Test snapshot comparison logic

---

### Phase 3: Session Detection (MVP)

**Goal**: Automatically detect when users start and end gaming sessions.

#### Step 3.1: Player Status Monitoring
- [ ] Add function to check `personastate` (Online/In-Game/Offline)
- [ ] Create `lib/services/player-status.ts`
- [ ] Store current status in database
- [ ] Handle API rate limits

#### Step 3.2: Basic Session Detection
- [ ] Detect when user goes from "Offline" → "In-Game" (session start)
- [ ] Detect when user goes from "In-Game" → "Offline/Online" (session end)
- [ ] Create session record when detected
- [ ] Handle edge cases (multiple games, status changes)

#### Step 3.3: Session Calculation
- [ ] Calculate playtime delta (end - start)
- [ ] Identify achievements unlocked during session
- [ ] Store session with calculated data
- [ ] Handle sessions that span multiple days

#### Step 3.4: Display Sessions (Basic)
- [ ] Add "Recent Sessions" section to game detail page
- [ ] Show session date, duration, achievements earned
- [ ] Simple list view (no feed yet)
- [ ] Add pagination if needed

---

### Phase 4: Polling Infrastructure

**Goal**: Set up automated background polling to track active users.

#### Step 4.1: Background Job Setup
- [ ] Set up Vercel Cron Jobs (or similar service)
- [ ] Create API route for polling: `/api/cron/poll-active-users`
- [ ] Basic polling logic (fetch active users from DB)
- [ ] Add authentication/security for cron endpoint

#### Step 4.2: Efficient Polling
- [ ] Only poll users with `personastate: 1` or `3` (Online/In-Game)
- [ ] Poll every 5-10 minutes (configurable)
- [ ] Implement rate limiting to respect Steam API limits
- [ ] Add logging and error handling
- [ ] Handle API failures gracefully

#### Step 4.3: Snapshot Automation
- [ ] Automatically take snapshots for active users
- [ ] Store snapshots in database
- [ ] Compare snapshots to detect changes
- [ ] Create sessions from snapshot comparisons
- [ ] Handle API errors gracefully

---

### Phase 5: Activity Feed (Strava-like)

**Goal**: Create a social feed where users can see their own and others' gaming activities.

#### Step 5.1: Activity Model
- [ ] Create `activities` table (processed session data)
- [ ] Fields: `user_id`, `game_id`, `duration`, `achievements`, `session_date`, `suffer_score`, etc.
- [ ] Process sessions into activities
- [ ] Add indexes for feed queries

#### Step 5.2: Feed UI Foundation
- [ ] Create `/feed` page
- [ ] Timeline layout (vertical scroll)
- [ ] Activity card component (basic)
- [ ] Show: user, game, duration, achievements
- [ ] Add infinite scroll or pagination

#### Step 5.3: Activity Card Design
- [ ] Game cover image
- [ ] Session duration display
- [ ] Achievement highlights (icons)
- [ ] Rarity scoring ("Suffer Score")
- [ ] Timestamp and relative time
- [ ] User avatar and name

#### Step 5.4: Feed Filtering
- [ ] Filter by game
- [ ] Filter by user
- [ ] Sort by date (newest first)
- [ ] Add search functionality
- [ ] Pagination or infinite scroll

---

### Phase 6: Social Features

**Goal**: Add social interactions like kudos, comments, and following.

#### Step 6.1: User Profiles
- [ ] Create user profile pages (`/users/[steamId]`)
- [ ] Show user's activity feed
- [ ] Stats overview (total playtime, achievements, etc.)
- [ ] Profile customization (bio, favorite games)
- [ ] Link to Steam profile

#### Step 6.2: Kudos System
- [ ] Add `kudos` table (`user_id`, `activity_id`, `created_at`)
- [ ] Kudos button on activity cards
- [ ] Display kudos count
- [ ] Prevent duplicate kudos
- [ ] Show who gave kudos (optional)

#### Step 6.3: Comments System
- [ ] Add `comments` table
- [ ] Comment form on activity cards
- [ ] Display comments (nested if needed)
- [ ] Edit/delete own comments
- [ ] Real-time updates (optional)

#### Step 6.4: Follow/Friends
- [ ] Add `follows` table
- [ ] Follow/unfollow buttons
- [ ] Personal feed (followed users only)
- [ ] Friends list page
- [ ] Import Steam friends (optional)

---

### Phase 7: Advanced Features

**Goal**: Add advanced tracking and visualization features.

#### Step 7.1: Session Naming
- [ ] Add `session_title` field to activities
- [ ] Edit session title UI
- [ ] Default titles ("Friday Night Raiding", etc.)
- [ ] Auto-generate titles based on achievements

#### Step 7.2: Rarity Scoring
- [ ] Calculate "Suffer Score" based on achievement rarity
- [ ] Visual indicators (gold glow for rare achievements)
- [ ] Display on activity cards
- [ ] Leaderboard for highest suffer scores

#### Step 7.3: Progress Visualization
- [ ] Progress bars for game completion
- [ ] Chapter/level progress (if available)
- [ ] Visual "route" through game
- [ ] Achievement timeline

#### Step 7.4: Ghost Activities
- [ ] Use `GetRecentlyPlayedGames` to detect missed sessions
- [ ] Create "Ghost Activity" for playtime increases
- [ ] Mark as "estimated" vs "tracked"
- [ ] Allow users to dismiss ghost activities

---

### Phase 8: Polish & Optimization

**Goal**: Optimize performance, improve UX, and add final touches.

#### Step 8.1: Performance
- [ ] Optimize database queries
- [ ] Add database indexes
- [ ] Cache frequently accessed data
- [ ] Optimize API calls (batch requests)
- [ ] Implement CDN for images

#### Step 8.2: Mobile Optimization
- [ ] Responsive feed design
- [ ] Touch-friendly interactions
- [ ] Mobile navigation
- [ ] Test on real devices

#### Step 8.3: Notifications
- [ ] Notify when friends start playing
- [ ] Notify on achievements
- [ ] Email/digest options
- [ ] In-app notification center

#### Step 8.4: Analytics
- [ ] User engagement metrics
- [ ] Popular games tracking
- [ ] Achievement trends
- [ ] Admin dashboard (optional)

---

## 🔧 Adding shadcn/ui Components

```bash
npx shadcn@latest add [component-name]
```

Example:
```bash
npx shadcn@latest add card
npx shadcn@latest add input
```

## 🎨 Theming

The theme system uses `next-themes` and automatically handles:
- System preference detection
- Light/dark mode switching
- Persistent theme selection

Use the `ThemeToggle` component anywhere in your app to allow users to switch themes.

## 📝 Notes

### Current Limitations

- **In-Memory Store**: Currently using `InMemoryDataAccess` which doesn't persist across serverless function invocations. This causes users to be logged out on refresh. **Solution**: Integrate Supabase (Phase 1.1).

### Steam API Considerations

- **Rate Limits**: Steam API has rate limits. Implement proper rate limiting and caching.
- **Hidden Achievements**: Some achievements don't return descriptions via the standard API. We use the legacy XML API as a fallback.
- **Image URLs**: Steam uses multiple CDN domains. We implement robust fallback logic for images.

## 🤝 Contributing

This is a personal project, but suggestions and feedback are welcome!

## 📄 License

[Add your license here]

---

**Current Phase**: Phase 1 - Complete Current Dashboard & Game Pages

**Next Milestone**: Supabase integration for session persistence
