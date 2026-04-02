import { Stoplight } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface IndicatorProps {
  status: Stoplight | string | undefined;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  className?: string;
}

export function StoplightIndicator({ status, size = "md", pulse = false, className }: IndicatorProps) {
  const sizeClasses = {
    sm: "h-2 w-2",
    md: "h-3 w-3",
    lg: "h-5 w-5"
  };

  const bgClasses = {
    red: "bg-[#ef4444] shadow-[0_0_8px_#ef4444]",
    yellow: "bg-[#eab308] shadow-[0_0_8px_#eab308]",
    green: "bg-[#22c55e] shadow-[0_0_8px_#22c55e]",
    default: "bg-muted shadow-none"
  };

  const color = status === "red" || status === "yellow" || status === "green" ? status : "default";

  return (
    <div 
      className={cn(
        "rounded-full shrink-0", 
        sizeClasses[size], 
        bgClasses[color],
        pulse && status === "red" ? "animate-pulse" : "",
        className
      )}
      title={`Status: ${status}`}
    />
  );
}

export function StoplightBadge({ status, label, className }: { status: Stoplight | string | undefined, label?: string, className?: string }) {
  const textColors = {
    red: "text-red-400 border-red-500/20 bg-red-500/10",
    yellow: "text-yellow-400 border-yellow-500/20 bg-yellow-500/10",
    green: "text-green-400 border-green-500/20 bg-green-500/10",
    default: "text-muted-foreground border-border bg-muted/20"
  };

  const color = status === "red" || status === "yellow" || status === "green" ? status : "default";

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium uppercase tracking-wider", textColors[color], className)}>
      <StoplightIndicator status={status} size="sm" />
      {label || status}
    </div>
  );
}
