'use server';
import { revalidatePath } from 'next/cache';
import { createSurgeryTypeAction, updateSurgeryTypeAction } from '@/actions/surgery-types';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';

export async function createSurgeryTypeFormAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = createSurgeryTypeAction(getDb(), actor, String(formData.get('name') ?? ''));
  if (!result.ok) throw new Error(result.error);
  revalidatePath('/settings/surgery-types'); revalidatePath('/operations');
}

export async function updateSurgeryTypeFormAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const result = updateSurgeryTypeAction(getDb(), actor, {
    surgeryTypeId: String(formData.get('surgeryTypeId') ?? ''), name: String(formData.get('name') ?? ''),
    status: String(formData.get('status') ?? ''),
  });
  if (!result.ok) throw new Error(result.error);
  revalidatePath('/settings/surgery-types'); revalidatePath('/operations');
}
