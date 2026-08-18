import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Surgery terminology and Patient ID UI contract', () => {
  it('uses Surgery terminology for all primary operation workflows', () => {
    const source = [
      'src/app/page.tsx',
      'src/app/operations/page.tsx',
      'src/app/operations/[id]/page.tsx',
      'src/app/operations/_components/create-operation-dialog.tsx',
      'src/app/operations/_components/operation-screen.tsx',
      'src/app/operations/_components/void-dialog.tsx',
      'src/app/operations/_components/delete-operation-dialog.tsx',
    ].map(read).join('\n');

    for (const oldText of [
      'Start New Operation',
      'Start Another Operation',
      'Resume Operation',
      'Finish Operation',
      'Void Operation',
      'Delete Operation',
      'Current Operations',
      'Past Operations',
      'All operations',
    ]) {
      expect(source).not.toContain(`>${oldText}<`);
      expect(source).not.toContain(`'${oldText}'`);
      expect(source).not.toContain(`"${oldText}"`);
    }
    expect(source).toContain('Start New Surgery');
    expect(source).toContain('Past Surgeries');
    expect(source).toContain('Finish Surgery');
  });

  it('collects a digits-only Patient ID when starting a surgery', () => {
    const dialog = read('src/app/operations/_components/create-operation-dialog.tsx');
    expect(dialog).toContain('name="patientId"');
    expect(dialog).toContain('placeholder="Enter Patient ID"');
    expect(dialog).toContain('inputMode="numeric"');
    expect(dialog).toContain('pattern="[0-9]+"');
    expect(dialog).toContain('required');
  });

  it('submits Patient ID search by server action and never adds it to URL parameters', () => {
    const filters = read('src/app/operations/_components/past-surgeries.tsx');
    const action = read('src/app/operations/actions.ts');
    expect(filters).toContain('action={formAction}');
    expect(action).toContain('searchPastSurgeriesFormAction');
    expect(filters).not.toMatch(/params\.set\(['"]patientId/);
    expect(filters).not.toMatch(/\/operations\?patientId/);
  });
});
