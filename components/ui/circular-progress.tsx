import * as React from "react";
import { cn } from "@/lib/utils";

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  textClassName?: string;
}

export function CircularProgress({
  percentage,
  size = 80,
  strokeWidth = 8,
  className,
  textClassName,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const center = size / 2;
  const backgroundStrokeWidth = strokeWidth + 4; // 4px thicker (2px on each side)
  // Increase viewBox to accommodate thicker background stroke (2px padding on each side)
  const viewBoxSize = size + 4;

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      {/* Background circle */}
      <svg
        width={size}
        height={size}
        viewBox={`-2 -2 ${viewBoxSize} ${viewBoxSize}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute"
        preserveAspectRatio="xMidYMid meet"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="hsl(var(--color-background))"
          strokeWidth={backgroundStrokeWidth}
        />
      </svg>

      {/* Progress circle */}
      <svg
        width={size}
        height={size}
        viewBox={`-2 -2 ${viewBoxSize} ${viewBoxSize}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute transition-all duration-300"
        preserveAspectRatio="xMidYMid meet"
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="hsl(var(--color-primary))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>

      {/* Percentage text */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          textClassName
        )}
      >
        <p className="text-xs font-bold text-center text-text-inverted-strong">
          {Math.round(percentage)}%
        </p>
      </div>
    </div>
  );
}
