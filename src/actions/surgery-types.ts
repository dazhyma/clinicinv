import type { AppDatabase } from '@/db/client';
import { isAdmin, type Actor } from '@/domain/actor';
import { createSurgeryType, listSurgeryTypes, updateSurgeryType } from '@/domain/surgery-types';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, runAction, type ActionResult } from './result';

export interface SurgeryTypeView { id: number; name: string; status: 'active' | 'inactive' }

export function listSurgeryTypesAction(db: AppDatabase, actor: Actor, includeInactive = false): SurgeryTypeView[] {
  return listSurgeryTypes(db, actor, includeInactive).map(({ id, name, status }) => ({ id, name, status }));
}

export function createSurgeryTypeAction(db: AppDatabase, actor: Actor, name: RawFormValue): ActionResult<SurgeryTypeView> {
  if (!isAdmin(actor)) return forbidden('manage Surgery Types');
  const v = new FieldValidator();
  const value = v.requiredText('name', name, 'Surgery Type', 120);
  if (v.hasErrors) return failFields(v.errors);
  return runAction(() => createSurgeryType(db, actor, value));
}

export function updateSurgeryTypeAction(db: AppDatabase, actor: Actor, input: {
  surgeryTypeId: RawFormValue; name: RawFormValue; status: RawFormValue;
}): ActionResult<SurgeryTypeView> {
  if (!isAdmin(actor)) return forbidden('manage Surgery Types');
  const v = new FieldValidator();
  const id = v.requiredInteger('surgeryTypeId', input.surgeryTypeId, 'Surgery Type', { min: 1 });
  const name = v.requiredText('name', input.name, 'Surgery Type', 120);
  const rawStatus = v.requiredText('status', input.status, 'Status', 20);
  if (rawStatus !== 'active' && rawStatus !== 'inactive') v.add('status', 'Select a valid status');
  if (v.hasErrors) return failFields(v.errors);
  return runAction(() => updateSurgeryType(db, actor, id, { name, status: rawStatus as 'active' | 'inactive' }));
}
