import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default function TestPage() {
  return (
    <main className="min-h-screen p-8 bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      
      <div className="max-w-6xl mx-auto space-y-12">
        <h1 className="text-4xl font-bold text-foreground">Design Token Test</h1>
        
        {/* Semantic Colors */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Semantic Colors</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-primary text-primary-foreground rounded-lg">
              Primary
            </div>
            <div className="p-4 bg-secondary text-secondary-foreground rounded-lg">
              Secondary
            </div>
            <div className="p-4 bg-accent text-accent-foreground rounded-lg">
              Accent
            </div>
            <div className="p-4 bg-muted text-muted-foreground rounded-lg">
              Muted
            </div>
            <div className="p-4 bg-success text-success-foreground rounded-lg">
              Success
            </div>
            <div className="p-4 bg-warning text-warning-foreground rounded-lg">
              Warning
            </div>
            <div className="p-4 bg-error text-error-foreground rounded-lg">
              Error
            </div>
            <div className="p-4 bg-info text-info-foreground rounded-lg">
              Info
            </div>
          </div>
        </section>
        
        {/* Black & White Transparency Ramps */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Black Transparency</h2>
          <div className="grid grid-cols-6 gap-2">
            {[950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50].map((shade) => (
              <div
                key={shade}
                className="p-4 bg-white-50 rounded text-center text-xs"
              >
                <div 
                  className="h-16 rounded mb-2" 
                  style={{ backgroundColor: `var(--color-black-${shade})` }}
                ></div>
                {shade}
              </div>
            ))}
          </div>
        </section>
        
        <section>
          <h2 className="text-2xl font-semibold mb-4">White Transparency</h2>
          <div className="grid grid-cols-6 gap-2 bg-slate-900 p-4 rounded">
            {[950, 900, 800, 700, 600, 500, 400, 300, 200, 100, 50].map((shade) => (
              <div
                key={shade}
                className="p-4 rounded text-center text-xs"
              >
                <div 
                  className="h-16 rounded mb-2"
                  style={{ backgroundColor: `var(--color-white-${shade})` }}
                ></div>
                {shade}
              </div>
            ))}
          </div>
        </section>
        
        {/* Raw Tailwind Colors */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Raw Tailwind Colors (Blue)</h2>
          <div className="grid grid-cols-6 gap-2">
            {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => (
              <div
                key={shade}
                className="p-4 bg-white-50 rounded text-center text-xs"
              >
                <div className={`h-16 bg-blue-${shade} rounded mb-2`}></div>
                {shade}
              </div>
            ))}
          </div>
        </section>
        
        {/* Spacing Tokens */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Spacing Tokens</h2>
          <div className="space-y-2">
            {['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].map((size) => (
              <div key={size} className="flex items-center gap-4">
                <span className="w-20 text-sm">{size}:</span>
                <div className={`bg-primary h-4`} style={{ width: `var(--spacing-${size})` }}></div>
              </div>
            ))}
          </div>
        </section>
        
        {/* Typography */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Typography</h2>
          <div className="space-y-2">
            <p className="text-xs">text-xs - Extra small</p>
            <p className="text-sm">text-sm - Small</p>
            <p className="text-base">text-base - Base</p>
            <p className="text-lg">text-lg - Large</p>
            <p className="text-xl">text-xl - Extra large</p>
            <p className="text-2xl">text-2xl - 2X Large</p>
            <p className="text-3xl">text-3xl - 3X Large</p>
            <p className="text-4xl">text-4xl - 4X Large</p>
            <p className="text-5xl">text-5xl - 5X Large</p>
          </div>
        </section>
        
        {/* Shadows */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Shadows</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="p-6 bg-card rounded-lg shadow-xs">shadow-xs</div>
            <div className="p-6 bg-card rounded-lg shadow-sm">shadow-sm</div>
            <div className="p-6 bg-card rounded-lg shadow-md">shadow-md</div>
            <div className="p-6 bg-card rounded-lg shadow-lg">shadow-lg</div>
            <div className="p-6 bg-card rounded-lg shadow-xl">shadow-xl</div>
            <div className="p-6 bg-card rounded-lg shadow-2xl">shadow-2xl</div>
          </div>
        </section>
        
        {/* Border Radius */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Border Radius</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="p-6 bg-primary text-primary-foreground rounded-none">rounded-none</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-sm">rounded-sm</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-md">rounded-md</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-lg">rounded-lg</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-xl">rounded-xl</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-2xl">rounded-2xl</div>
            <div className="p-6 bg-primary text-primary-foreground rounded-full">rounded-full</div>
          </div>
        </section>
        
        {/* Buttons */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Button Variants</h2>
          <div className="flex flex-wrap gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
          </div>
        </section>
        
        {/* Surface Variants */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Surface Variants</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-6 bg-surface rounded-lg border border-border">
              Surface
            </div>
            <div className="p-6 bg-surface-elevated rounded-lg border border-border">
              Surface Elevated
            </div>
            <div className="p-6 bg-surface-overlay rounded-lg border border-border">
              Surface Overlay
            </div>
          </div>
        </section>
        
        {/* Chart Colors */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Chart Colors</h2>
          <div className="grid grid-cols-5 gap-4">
            <div className="p-6 bg-chart-1 rounded-lg text-white">Chart 1</div>
            <div className="p-6 bg-chart-2 rounded-lg text-white">Chart 2</div>
            <div className="p-6 bg-chart-3 rounded-lg text-white">Chart 3</div>
            <div className="p-6 bg-chart-4 rounded-lg text-white">Chart 4</div>
            <div className="p-6 bg-chart-5 rounded-lg text-white">Chart 5</div>
          </div>
        </section>
      </div>
    </main>
  );
}

