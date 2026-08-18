import { describe, expect, it } from 'vitest';
import {
  getOperationState,
  listOperationsForActor,
  searchPastSurgeriesByPatientIdAction,
  startOperationAction,
} from '@/actions/operations';
import { operations } from '@/db/schema';
import { finishOperation, startOperation, voidOperation } from '@/domain/operations';
import {
  decryptPatientId,
  encryptPatientId,
  patientIdLookup,
} from '@/security/patient-id';
import { makeDoctor, setupTestDb } from './helpers';

function success<T>(result: { ok: boolean }): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return (result as { ok: true; data: T }).data;
}

describe('Patient ID encryption', () => {
  it('round-trips with authenticated encryption and a fresh nonce', () => {
    const first = encryptPatientId('00157284');
    const second = encryptPatientId('00157284');

    expect(first).not.toBe(second);
    expect(first).not.toContain('00157284');
    expect(decryptPatientId(first)).toBe('00157284');
    expect(patientIdLookup('00157284')).toBe(patientIdLookup('00157284'));
    expect(patientIdLookup('00157284')).not.toBe(patientIdLookup('157284'));
  });

  it('rejects modified ciphertext instead of returning corrupted data', () => {
    const encrypted = encryptPatientId('00157284');
    const parts = encrypted.split('.');
    const tag = Buffer.from(parts[2]!, 'base64url');
    tag[0] = (tag[0] ?? 0) ^ 1;
    parts[2] = tag.toString('base64url');
    const tampered = parts.join('.');
    expect(() => decryptPatientId(tampered)).toThrow();
  });
});

describe('Patient ID lifecycle', () => {
  it('requires digits, trims outer whitespace and preserves leading zeroes', () => {
    const ctx = setupTestDb();
    const missing = startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '   ',
    });
    expect(missing).toMatchObject({
      ok: false,
      fieldErrors: { patientId: 'Patient ID is required.' },
    });

    const invalid = startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '001-57',
    });
    expect(invalid).toMatchObject({
      ok: false,
      fieldErrors: { patientId: 'Patient ID must contain digits only.' },
    });

    const created = success<{ operationId: number }>(
      startOperationAction(ctx.db, ctx.staff, {
        doctorId: ctx.doctor.id,
        patientId: '  00157284  ',
      }),
    );
    expect(getOperationState(ctx.db, ctx.staff, created.operationId)?.patientId).toBe('00157284');

    const stored = ctx.db.select().from(operations).get()!;
    expect(stored.patientIdEncrypted).not.toContain('00157284');
    expect(stored.patientIdLookup).toBe(patientIdLookup('00157284'));
  });

  it('keeps pre-migration rows readable as Not provided/null', () => {
    const ctx = setupTestDb();
    const surgery = startOperation(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '000123',
    });
    ctx.db
      .update(operations)
      .set({ patientIdEncrypted: null, patientIdLookup: null })
      .run();

    expect(getOperationState(ctx.db, ctx.staff, surgery.id)?.patientId).toBeNull();
  });
});

describe('exact Patient ID search', () => {
  it('returns every exact match, combines filters and preserves Voided permissions', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');

    const finished = startOperation(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '00157284',
    });
    finishOperation(ctx.db, ctx.staff, finished.id);

    const voided = startOperation(ctx.db, ctx.staff, {
      doctorId: wong.id,
      patientId: '00157284',
    });
    finishOperation(ctx.db, ctx.staff, voided.id);
    voidOperation(ctx.db, ctx.admin, voided.id);

    const different = startOperation(ctx.db, ctx.staff, {
      doctorId: wong.id,
      patientId: '157284',
    });
    finishOperation(ctx.db, ctx.staff, different.id);

    const adminResult = success<ReturnType<typeof listOperationsForActor>>(
      searchPastSurgeriesByPatientIdAction(ctx.db, ctx.admin, { patientId: '00157284' }),
    );
    expect(adminResult.finished.map((row) => row.id)).toEqual([finished.id]);
    expect(adminResult.voided.map((row) => row.id)).toEqual([voided.id]);
    expect(adminResult.finished[0]?.patientId).toBe('00157284');

    const doctorResult = success<ReturnType<typeof listOperationsForActor>>(
      searchPastSurgeriesByPatientIdAction(ctx.db, ctx.admin, {
        patientId: '00157284',
        doctorId: String(wong.id),
      }),
    );
    expect(doctorResult.finished).toEqual([]);
    expect(doctorResult.voided.map((row) => row.id)).toEqual([voided.id]);

    const staffResult = success<ReturnType<typeof listOperationsForActor>>(
      searchPastSurgeriesByPatientIdAction(ctx.db, ctx.staff, { patientId: '00157284' }),
    );
    expect(staffResult.finished.map((row) => row.id)).toEqual([finished.id]);
    expect(staffResult.voided).toEqual([]);
  });

  it('omits Patient ID from ordinary past-history responses', () => {
    const ctx = setupTestDb();
    const surgery = startOperation(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '00157284',
    });
    finishOperation(ctx.db, ctx.staff, surgery.id);

    const ordinary = listOperationsForActor(ctx.db, ctx.staff, {});
    expect(ordinary.finished[0]).not.toHaveProperty('patientId');
  });

  it('keeps active surgeries visible under history filters', () => {
    const ctx = setupTestDb();
    const surgery = startOperation(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id,
      patientId: '00157284',
    });

    const filtered = listOperationsForActor(ctx.db, ctx.staff, {
      status: 'Finished',
      q: 'DOES-NOT-MATCH',
    });
    expect(filtered.active.map((row) => row.id)).toEqual([surgery.id]);
    expect(filtered.active[0]?.patientId).toBe('00157284');
  });
});
