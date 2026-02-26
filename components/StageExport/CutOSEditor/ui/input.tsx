import * as React from 'react';
import { cn } from '../../../../lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1 text-[var(--text-primary)] shadow-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50 focus:border-[var(--accent)]',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
