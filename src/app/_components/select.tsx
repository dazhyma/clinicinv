'use client';

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon } from './icons';

interface SelectOption {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return '';
}

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) {
      return [];
    }
    if (child.type !== 'option') return readOptions(child.props.children);
    const label = child.props.children;
    return [{
      value: String(child.props.value ?? textContent(label)),
      label,
      text: textContent(label).trim(),
      disabled: Boolean(child.props.disabled),
    }];
  });
}

function availableIndex(options: SelectOption[], start: number, direction: 1 | -1): number {
  if (options.length === 0) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + direction * step + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Единый dropdown для существующих select. Нативный select остаётся внутри
 * формы и получает те же name/value/onChange, а доступный listbox отвечает за
 * единый внешний вид в Safari, Chrome, iPadOS и Android.
 */
export function Select({
  children,
  className = '',
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...nativeProps
}: NativeSelectProps) {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const options = useMemo(() => readOptions(children), [children]);
  const initialValue = String(value ?? defaultValue ?? options[0]?.value ?? '');
  const [selectedValue, setSelectedValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (value !== undefined) setSelectedValue(String(value));
  }, [value]);

  useEffect(() => {
    const native = nativeRef.current;
    const form = native?.form;
    if (!native || !form) return;
    const reset = () => {
      requestAnimationFrame(() => setSelectedValue(native.value));
      setOpen(false);
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, []);

  useEffect(() => () => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
  }, []);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const edge = 8;
    const gap = 6;
    const desiredHeight = Math.min(320, Math.max(52, options.length * 48 + 12));
    const below = window.innerHeight - rect.bottom - edge - gap;
    const above = rect.top - edge - gap;
    const opensAbove = below < Math.min(180, desiredHeight) && above > below;
    const maxHeight = Math.max(96, Math.min(desiredHeight, opensAbove ? above : below));
    const width = Math.min(rect.width, window.innerWidth - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - edge - width);
    setMenuStyle({
      position: 'fixed',
      left,
      width,
      maxHeight,
      ...(opensAbove
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const reposition = () => positionMenu();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !document.getElementById(listboxId)?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [listboxId, open, positionMenu]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openMenu(preferredIndex = selectedIndex) {
    if (disabled) return;
    setActiveIndex(
      preferredIndex >= 0 && !options[preferredIndex]?.disabled
        ? preferredIndex
        : availableIndex(options, -1, 1),
    );
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    const native = nativeRef.current;
    if (!option || option.disabled || !native) return;
    setSelectedValue(option.value);
    setActiveIndex(index);
    setOpen(false);

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(native, option.value);
    native.dispatchEvent(new Event('change', { bubbles: true }));
    triggerRef.current?.focus();
  }

  function move(direction: 1 | -1) {
    const start = activeIndex >= 0 ? activeIndex : selectedIndex;
    const next = availableIndex(options, start, direction);
    if (next >= 0) setActiveIndex(next);
  }

  function typeahead(key: string) {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();
    const query = typeaheadRef.current;
    const start = activeIndex >= 0 ? activeIndex : selectedIndex;
    for (let step = 1; step <= options.length; step += 1) {
      const index = (start + step) % options.length;
      const option = options[index];
      if (option && !option.disabled && option.text.toLocaleLowerCase().startsWith(query)) {
        setActiveIndex(index);
        if (!open) openMenu(index);
        break;
      }
    }
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = '';
    }, 700);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) openMenu();
      const start = event.key === 'Home' ? -1 : options.length;
      const index = availableIndex(options, start, event.key === 'Home' ? 1 : -1);
      if (index >= 0) setActiveIndex(index);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open && activeIndex >= 0) choose(activeIndex);
      else openMenu();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead(event.key);
    }
  }

  return (
    <span className={`ui-select ${className}`} data-open={open || undefined}>
      <select
        {...nativeProps}
        ref={nativeRef}
        name={nativeProps.name}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => {
          setSelectedValue(event.currentTarget.value);
          onChange?.(event);
        }}
        className="ui-select-native"
        tabIndex={-1}
        aria-hidden="true"
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className="ui-select-trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? ''}</span>
        <ChevronDownIcon className="ui-select-chevron shrink-0" size={20} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={listboxId}
              role="listbox"
              aria-labelledby={selectId}
              className="ui-select-menu"
              style={menuStyle}
            >
              {options.map((option, index) => (
                <div
                  key={`${option.value}-${index}`}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === selectedValue}
                  aria-disabled={option.disabled || undefined}
                  className="ui-select-option"
                  data-active={index === activeIndex || undefined}
                  data-disabled={option.disabled || undefined}
                  onPointerMove={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onClick={() => choose(index)}
                >
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {option.value === selectedValue ? <CheckIcon className="shrink-0" size={19} /> : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
