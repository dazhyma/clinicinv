'use client';

import { useEffect, useState } from 'react';
import { Alert } from './ui';

export function AutoDismissAlert({
  children,
  tone = 'success',
  delay = 5000,
}: {
  children: React.ReactNode;
  tone?: 'success' | 'info';
  delay?: number;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-[70] w-[min(24rem,calc(100vw-2rem))] animate-[page-enter_220ms_ease-out_both] shadow-[var(--shadow-raised)]">
      <Alert tone={tone}>
        <div className="flex items-start justify-between gap-3">
          <div>{children}</div>
          <button
            aria-label="Dismiss notification"
            className="-m-2 min-h-10 min-w-10 rounded-lg text-lg font-semibold opacity-70 hover:bg-black/5 hover:opacity-100"
            onClick={() => setVisible(false)}
            type="button"
          >
            ×
          </button>
        </div>
      </Alert>
    </div>
  );
}

