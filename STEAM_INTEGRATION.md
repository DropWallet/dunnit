# Steam Integration Setup

## Environment Variables

Create a `.env.local` file in the root directory with:

```env
STEAM_API_KEY=2030557A2934C8A2D5395F7B7B081586
NEXTAUTH_URL=http://localhost:3000
```

## API Endpoints

### Authentication
- `GET /api/auth/steam` - Initiate Steam login (redirects to Steam)
- `GET /api/auth/steam/callback` - Steam OAuth callback (handles authentication)
- `POST /api/auth/logout` - Logout (clears session)

### User Data
- `GET /api/user` - Get current authenticated user
- `GET /api/games` - Get user's game library
- `GET /api/achievements?appId=123` - Get achievements for a specific game

## Usage Examples

### Frontend: Login
```tsx
// Redirect to Steam login
window.location.href = '/api/auth/steam';
```

### Frontend: Fetch Games
```tsx
const response = await fetch('/api/games');
const { games } = await response.json();
```

### Frontend: Fetch Achievements
```tsx
const response = await fetch(`/api/achievements?appId=730`);
const { achievements } = await response.json();
```

### Frontend: Get Current User
```tsx
const response = await fetch('/api/user');
const { user } = await response.json();
```

### Frontend: Logout
```tsx
await fetch('/api/auth/logout', { method: 'POST' });
```

## Architecture

### Data Flow
1. User clicks "Login with Steam"
2. Redirects to `/api/auth/steam` → Steam OpenID
3. Steam redirects to `/api/auth/steam/callback`
4. Server verifies authentication
5. Fetches user profile from Steam API
6. Saves user to in-memory store
7. Sets session cookie
8. Redirects to `/dashboard`

### Data Storage
- **Current**: In-memory (Map-based)
- **Future**: Easy to swap to PostgreSQL by implementing the same `DataAccess` interface

### Caching
- Games and achievements are cached in memory
- Cache is refreshed when empty (can add TTL later)

## Next Steps
- [ ] Build dashboard UI components
- [ ] Add game detail pages
- [ ] Implement achievement progress tracking
- [ ] Add friend search functionality
