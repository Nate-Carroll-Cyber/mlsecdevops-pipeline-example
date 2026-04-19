import { Info } from 'lucide-react';

interface HelpTooltipProps {
  text: string;
  widthClassName?: string;
  align?: 'center' | 'left' | 'right';
}

export function HelpTooltip({ text, widthClassName = 'w-56', align = 'center' }: HelpTooltipProps) {
  const alignmentClassName =
    align === 'left'
      ? 'left-0 translate-x-0'
      : align === 'right'
        ? 'right-0 left-auto translate-x-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={text}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        className={`pointer-events-none absolute top-[calc(100%+8px)] z-50 hidden rounded-md border border-border bg-popover px-3 py-2 text-[11px] font-normal normal-case leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-within:block ${alignmentClassName} ${widthClassName}`}
      >
        {text}
      </span>
    </span>
  );
}
