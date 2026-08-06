import Link from 'next/link';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

import { AlertIcon, CheckIcon, InfoIcon } from './icons';

type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'danger';
type ButtonSize = 'standard' | 'compact' | 'large';

export function buttonClassName({
  variant = 'primary',
  size = 'standard',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return [
    'ui-button',
    `ui-button-${variant}`,
    size === 'compact' ? 'ui-button-compact' : '',
    size === 'large' ? 'min-h-13 px-7 text-lg' : '',
    fullWidth ? 'w-full' : '',
    className,
  ].filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  size = 'standard',
  fullWidth = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}) {
  return <button className={buttonClassName({ variant, size, fullWidth, className })} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'standard',
  fullWidth = false,
  className = '',
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}) {
  return <Link className={buttonClassName({ variant, size, fullWidth, className })} {...props} />;
}

export function Card({ interactive = false, className = '', ...props }: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return <section className={`app-card ${interactive ? 'app-card-interactive' : ''} ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-field ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-field ${className}`} {...props} />;
}

export function FieldLabel({ className = '', ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`ui-label ${className}`} {...props} />;
}

export function Checkbox({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 ${className}`} type="checkbox" {...props} />;
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: 'active' | 'success' | 'danger' | 'warning' | 'neutral'; children: ReactNode }) {
  const tones = {
    active: 'bg-blue-100 text-blue-900',
    success: 'bg-emerald-100 text-emerald-900',
    danger: 'bg-red-100 text-red-900',
    warning: 'bg-amber-100 text-amber-900',
    neutral: 'bg-slate-100 text-slate-700',
  };
  return <span className={`ui-badge ${tones[tone]}`}>{children}</span>;
}

export function Alert({ tone = 'info', children, className = '', role }: { tone?: 'success' | 'warning' | 'danger' | 'info'; children: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const Icon = tone === 'success' ? CheckIcon : tone === 'danger' || tone === 'warning' ? AlertIcon : InfoIcon;
  return <div className={`ui-alert ui-alert-${tone} ${className}`} role={role ?? (tone === 'danger' ? 'alert' : 'status')}><Icon className="mt-0.5 shrink-0" /><div className="min-w-0">{children}</div></div>;
}

export function EmptyState({ title, description, action, className = '' }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={`ui-empty-state ${className}`}><InfoIcon size={28} /><div><p className="text-lg font-semibold text-slate-800">{title}</p>{description ? <p className="mt-1">{description}</p> : null}</div>{action}</div>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="ui-empty-state" role="status"><span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--color-primary)]" aria-hidden="true" /><span>{label}</span></div>;
}

