import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { CATEGORIES, cat } from '../lib/categories';

export function CategoryPill({ id, onClick }: { id: string; onClick?: () => void }) {
  const c = cat(id);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95"
      style={{ background: `${c.color}1f`, color: c.color }}
    >
      <span aria-hidden>{c.emoji}</span>
      <span className="truncate">{c.label}</span>
    </button>
  );
}

export function CategoryPicker({
  value, merchant, onPick, onClose,
}: {
  value: string;
  merchant: string;
  onPick: (category: string, rememberForMerchant: boolean) => void;
  onClose: () => void;
}) {
  const [remember, setRemember] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);

  return (
    <div ref={ref} className="card absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] p-3">
      <div className="grid grid-cols-2 gap-1">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => onPick(c.id, remember)}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${c.id === value ? 'bg-slate-100 font-medium dark:bg-slate-800' : ''}`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="truncate">{c.label}</span>
            {c.id === value && <Check className="ml-auto h-3.5 w-3.5 text-indigo-500" />}
          </button>
        ))}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-indigo-600" />
        Remember for every payment to <span className="truncate font-medium text-slate-900 dark:text-slate-100">{merchant}</span>
      </label>
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Progress({ value, marker, color }: { value: number; marker?: number; color: string }) {
  const clamp = (n: number) => `${Math.min(100, Math.max(0, n * 100))}%`;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      {marker !== undefined && marker > value && (
        <div className="absolute inset-y-0 left-0 rounded-full opacity-25" style={{ width: clamp(marker), background: color }} />
      )}
      <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: clamp(value), background: value > 1 ? '#ef4444' : color }} />
    </div>
  );
}
