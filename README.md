# Dunnit - Game Tracking & Achievement Platform

A modern game tracking and achievement platform with Steam integration, built with Next.js, Tailwind CSS, and shadcn/ui.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with design tokens
- **UI Components**: shadcn/ui
- **Theme**: Automatic light/dark mode with CSS variables
- **Language**: TypeScript

## Design System

### Token Architecture

The project uses a semantic token system with CSS custom properties:

- **Semantic tokens**: `primary`, `secondary`, `background`, `foreground`, etc.
- **Raw color tokens**: Stored as HSL values in CSS variables
- **Automatic theming**: Light/dark mode swaps token values automatically

### Token Structure

Tokens are defined in `app/globals.css`:
- `:root` - Light mode tokens
- `.dark` - Dark mode tokens

Tailwind classes use semantic names:
- `bg-primary`, `text-foreground`, `border-border`, etc.

### Customizing Tokens

Update the HSL values in `app/globals.css` to match your Figma design:

```css
:root {
  --primary: 221.2 83.2% 53.3%; /* HSL values without hsl() wrapper */
  --primary-foreground: 210 40% 98%;
  /* ... */
}
```

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
dunnit/
├── app/
│   ├── globals.css          # Design tokens and global styles
│   ├── layout.tsx           # Root layout with theme provider
│   └── page.tsx             # Home page
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── theme-provider.tsx   # Theme context provider
│   └── theme-toggle.tsx     # Theme switcher component
├── lib/
│   └── utils.ts             # Utility functions (cn helper)
└── tailwind.config.ts       # Tailwind configuration
```

## Adding shadcn/ui Components

```bash
npx shadcn@latest add [component-name]
```

Example:
```bash
npx shadcn@latest add card
npx shadcn@latest add input
```

## Theming

The theme system uses `next-themes` and automatically handles:
- System preference detection
- Light/dark mode switching
- Persistent theme selection

Use the `ThemeToggle` component anywhere in your app to allow users to switch themes.

## Next Steps

- [ ] Set up Steam API integration
- [ ] Create authentication flow
- [ ] Build game library display
- [ ] Implement achievement tracking
- [ ] Add friend search and follow features

