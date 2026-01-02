import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Blue shades for raw color demo
    'bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400',
    'bg-blue-500', 'bg-blue-600', 'bg-blue-700', 'bg-blue-800', 'bg-blue-900', 'bg-blue-950',
    // Surface variants
    'bg-surface-low', 'bg-surface-mid', 'bg-surface-high',
    // Text inverted variants
    'text-inverted-strong', 'text-inverted-subdued',
    // Rarity colors
    'bg-rarity-legendary', 'bg-rarity-very-rare', 'bg-rarity-rare', 'bg-rarity-uncommon', 'bg-rarity-common',
    'border-rarity-legendary', 'border-rarity-very-rare', 'border-rarity-rare', 'border-rarity-uncommon', 'border-rarity-common',
    // Shelf shadows
    'shadow-shelf',
    'dark:shadow-shelf-dark',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic color tokens - mapped from CSS variables
        background: "hsl(var(--color-background))",
        foreground: "hsl(var(--color-foreground))",
        
        // Surface variants
        surface: {
          DEFAULT: "hsl(var(--color-surface))",
          elevated: "hsl(var(--color-surface-elevated))",
          overlay: "hsl(var(--color-surface-overlay))",
          low: "hsl(var(--color-surface-low))",
          mid: "hsl(var(--color-surface-mid))",
          high: "hsl(var(--color-surface-high))",
          "transparent-mid": "var(--color-surface-transparent-mid)",
          "transparent-high": "var(--color-surface-transparent-high)",
        },
        
        // Interactive colors
        primary: {
          DEFAULT: "hsl(var(--color-primary))",
          hover: "hsl(var(--color-primary-hover))",
          active: "hsl(var(--color-primary-active))",
          foreground: "hsl(var(--color-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--color-secondary))",
          hover: "hsl(var(--color-secondary-hover))",
          active: "hsl(var(--color-secondary-active))",
          foreground: "hsl(var(--color-secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--color-accent))",
          foreground: "hsl(var(--color-accent-foreground))",
        },
        
        // Feedback colors
        success: {
          DEFAULT: "hsl(var(--color-success))",
          foreground: "hsl(var(--color-success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--color-warning))",
          foreground: "hsl(var(--color-warning-foreground))",
        },
        error: {
          DEFAULT: "hsl(var(--color-error))",
          foreground: "hsl(var(--color-error-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--color-info))",
          foreground: "hsl(var(--color-info-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--color-error))",
          foreground: "hsl(var(--color-error-foreground))",
        },
        
        // Neutral colors
        muted: {
          DEFAULT: "hsl(var(--color-muted))",
          foreground: "hsl(var(--color-muted-foreground))",
        },
        subtle: {
          DEFAULT: "hsl(var(--color-subtle))",
          foreground: "hsl(var(--color-subtle-foreground))",
        },
        
        // Border & divider
        border: "hsl(var(--color-border))",
        "border-subtle": "hsl(var(--color-border-subtle))",
        "border-strong": "hsl(var(--color-border-strong))",
        "border-inverted-moderate": "var(--color-border-inverted-moderate)",
        "border-rarity-legendary": "hsl(var(--color-rarity-legendary))",
        "border-rarity-very-rare": "hsl(var(--color-rarity-very-rare))",
        "border-rarity-rare": "hsl(var(--color-rarity-rare))",
        "border-rarity-uncommon": "hsl(var(--color-rarity-uncommon))",
        "border-rarity-common": "hsl(var(--color-rarity-common))",
        divider: "hsl(var(--color-divider))",
        
        // Input
        input: "hsl(var(--color-input))",
        "input-focus": "hsl(var(--color-input-focus))",
        "input-error": "hsl(var(--color-input-error))",
        
        // Focus ring
        ring: "hsl(var(--color-ring))",
        "ring-offset": "hsl(var(--color-ring-offset))",
        
        // Card & popover
        card: {
          DEFAULT: "hsl(var(--color-card))",
          foreground: "hsl(var(--color-card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--color-popover))",
          foreground: "hsl(var(--color-popover-foreground))",
        },
        
        // Chart colors
        chart: {
          "1": "hsl(var(--color-chart-1))",
          "2": "hsl(var(--color-chart-2))",
          "3": "hsl(var(--color-chart-3))",
          "4": "hsl(var(--color-chart-4))",
          "5": "hsl(var(--color-chart-5))",
        },
        
        // Typography colors
        "text-strong": "hsl(var(--color-text-strong))",
        "text-moderate": "hsl(var(--color-text-moderate))",
        "text-subdued": "hsl(var(--color-text-subdued))",
        "text-weak": "hsl(var(--color-text-weak))",
        "text-inverted-strong": "hsl(var(--color-text-inverted-strong))",
        "text-inverted-subdued": "hsl(var(--color-text-inverted-subdued))",
        
        // Translucent colors
        "translucent-weakest": "var(--color-translucent-weakest)",
        
        // Achievement rarity colors
        rarity: {
          legendary: "hsl(var(--color-rarity-legendary))",
          "very-rare": "hsl(var(--color-rarity-very-rare))",
          rare: "hsl(var(--color-rarity-rare))",
          uncommon: "hsl(var(--color-rarity-uncommon))",
          common: "hsl(var(--color-rarity-common))",
        },
        
        // Black & White transparency ramps
        black: {
          DEFAULT: "var(--color-black)",
          50: "var(--color-black-50)",
          100: "var(--color-black-100)",
          200: "var(--color-black-200)",
          300: "var(--color-black-300)",
          400: "var(--color-black-400)",
          500: "var(--color-black-500)",
          600: "var(--color-black-600)",
          700: "var(--color-black-700)",
          800: "var(--color-black-800)",
          900: "var(--color-black-900)",
          950: "var(--color-black-950)",
        },
        white: {
          DEFAULT: "var(--color-white)",
          50: "var(--color-white-50)",
          100: "var(--color-white-100)",
          200: "var(--color-white-200)",
          300: "var(--color-white-300)",
          400: "var(--color-white-400)",
          500: "var(--color-white-500)",
          600: "var(--color-white-600)",
          700: "var(--color-white-700)",
          800: "var(--color-white-800)",
          900: "var(--color-white-900)",
          950: "var(--color-white-950)",
        },
      },
      spacing: {
        // Semantic spacing tokens
        xs: "var(--spacing-xs)",
        sm: "var(--spacing-sm)",
        md: "var(--spacing-md)",
        lg: "var(--spacing-lg)",
        "6": "var(--spacing-6)",
        xl: "var(--spacing-xl)",
        "2xl": "var(--spacing-2xl)",
        "3xl": "var(--spacing-3xl)",
        "4xl": "var(--spacing-4xl)",
      },
      fontSize: {
        // Semantic font size tokens
        xs: ["var(--font-size-xs)", { lineHeight: "var(--line-height-normal)" }],
        sm: ["var(--font-size-sm)", { lineHeight: "var(--line-height-normal)" }],
        base: ["var(--font-size-base)", { lineHeight: "var(--line-height-normal)" }],
        lg: ["var(--font-size-lg)", { lineHeight: "var(--line-height-normal)" }],
        xl: ["var(--font-size-xl)", { lineHeight: "var(--line-height-normal)" }],
        "2xl": ["var(--font-size-2xl)", { lineHeight: "var(--line-height-tight)" }],
        "3xl": ["var(--font-size-3xl)", { lineHeight: "var(--line-height-tight)" }],
        "4xl": ["var(--font-size-4xl)", { lineHeight: "var(--line-height-tight)" }],
        "5xl": ["var(--font-size-5xl)", { lineHeight: "var(--line-height-tight)" }],
      },
      fontWeight: {
        normal: "var(--font-weight-normal)",
        medium: "var(--font-weight-medium)",
        semibold: "var(--font-weight-semibold)",
        bold: "var(--font-weight-bold)",
      },
      lineHeight: {
        tight: "var(--line-height-tight)",
        normal: "var(--line-height-normal)",
        relaxed: "var(--line-height-relaxed)",
      },
      letterSpacing: {
        tight: "var(--letter-spacing-tight)",
        normal: "var(--letter-spacing-normal)",
        wide: "var(--letter-spacing-wide)",
      },
      boxShadow: {
        // Semantic shadow tokens
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        inner: "var(--shadow-inner)",
        "game-cover": "var(--shadow-game-cover)",
        shelf: "var(--shadow-shelf)",
        "shelf-dark": "var(--shadow-shelf-dark)",
      },
      borderRadius: {
        // Semantic radius tokens
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
        // Base radius (for components)
        DEFAULT: "var(--radius)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
        slower: "var(--duration-slower)",
      },
      transitionTimingFunction: {
        "in": "var(--ease-in)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        spring: "var(--ease-spring)",
      },
      zIndex: {
        base: "var(--z-base)",
        dropdown: "var(--z-dropdown)",
        sticky: "var(--z-sticky)",
        fixed: "var(--z-fixed)",
        "modal-backdrop": "var(--z-modal-backdrop)",
        modal: "var(--z-modal)",
        popover: "var(--z-popover)",
        tooltip: "var(--z-tooltip)",
        toast: "var(--z-toast)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      screens: {
        // Tailwind default breakpoints
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
      backgroundImage: {
        "progress-bar": "var(--gradient-progress-bar)",
      },
    },
  },
  plugins: [],
};

export default config;
