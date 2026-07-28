'use client';

import { useRouter } from 'next/navigation';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import {
  BarcodeCapture,
  type BarcodeConfirmOutcome,
  type BarcodeScanSource,
} from '../../_components/barcode-capture';

export function ReceiveStockScanner({ autoOpenCamera = false }: { autoOpenCamera?: boolean }) {
  const router = useRouter();

  function confirmItem(
    target: BarcodeConfirmationView,
    source: BarcodeScanSource,
  ): BarcodeConfirmOutcome {
    const returnMode = source === 'camera' ? 'camera' : 'hid';
    router.push(`/inventory/items/${target.id}/stock?returnToScanner=${returnMode}`);
    return { ok: true, next: 'keep' };
  }

  return (
    <BarcodeCapture
      id="receive-scan"
      label="Scan an item barcode"
      confirmLabel="Confirm Item"
      allowPacks={false}
      autoOpenCamera={autoOpenCamera}
      onConfirm={confirmItem}
    />
  );
}
