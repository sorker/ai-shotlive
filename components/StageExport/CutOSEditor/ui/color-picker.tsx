import { useState, useRef, useEffect } from 'react';
import { Eye } from 'lucide-react';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function ColorPicker({ value, onChange, disabled }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div
          className="h-5 w-5 rounded border border-[var(--border-primary)]"
          style={{ backgroundColor: value }}
        />
        <span className="text-[var(--text-muted)]">{value.toUpperCase()}</span>
        <Eye className="h-3.5 w-3.5 text-[var(--text-muted)]" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 shadow-xl">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div
                className="h-16 w-16 shrink-0 rounded border-2 border-[var(--border-primary)]"
                style={{ backgroundColor: value }}
              />
              <div className="flex-1">
                <p className="mb-1 text-xs font-medium text-[var(--text-primary)]">颜色</p>
                <input
                  type="text"
                  value={value || '#00FF00'}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    if (val === '' || /^#?[0-9A-Fa-f]{0,6}$/i.test(val)) {
                      onChange(val.startsWith('#') ? val : val ? `#${val}` : '#');
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (!val || !/^#?[0-9A-Fa-f]{6}$/i.test(val)) {
                      onChange(value || '#00FF00');
                    }
                  }}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  placeholder="#00FF00"
                  disabled={disabled}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">选择颜色:</label>
              <input
                type="color"
                value={value || '#00FF00'}
                onChange={(e) => e.target.value && onChange(e.target.value)}
                className="h-10 w-full cursor-pointer rounded border border-[var(--border-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
