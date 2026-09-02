import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('shared Select UI contract', () => {
  it('routes every existing dropdown through the shared Select component', () => {
    const rawSelectFiles = tsxFiles(join(root, 'src/app'))
      .filter((path) => readFileSync(path, 'utf8').includes('<select'))
      .map((path) => relative(root, path));

    expect(rawSelectFiles).toEqual(['src/app/_components/select.tsx']);
  });

  it('keeps form compatibility and accessible listbox interactions', () => {
    const source = readFileSync(join(root, 'src/app/_components/select.tsx'), 'utf8');

    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("new Event('change', { bubbles: true })");
    expect(source).toContain('createPortal');
    expect(source).not.toContain('scrollIntoView');
    expect(source).toContain('listbox.scrollTop');
    expect(source).toContain('preventScroll: true');
  });

  it('does not turn existing datalist text fields into new dropdowns', () => {
    const itemForm = readFileSync(
      join(root, 'src/app/inventory/_components/item-form.tsx'),
      'utf8',
    );

    expect(itemForm).toContain('<datalist id="unit-options">');
    expect(itemForm).toContain('<datalist id="category-options">');
    expect(itemForm).toContain('<datalist id="location-options">');
  });

  it('uses the shared compact action row for Past Surgeries filters', () => {
    const operations = readFileSync(
      join(root, 'src/app/operations/_components/past-surgeries.tsx'),
      'utf8',
    );

    expect(operations).toContain('<FilterActions>');
    expect(operations).toContain('Apply Filters');
    expect(operations).toContain('Clear Filters');
  });
});
