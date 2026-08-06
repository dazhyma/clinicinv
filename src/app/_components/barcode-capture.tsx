'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import { resolveBarcodeServerAction } from '../_actions/scanning';
import { newClientEventId } from './client-event-id';
import { ItemPhoto } from './item-photo';

export type BarcodeScanSource = 'camera' | 'hid';

export interface BarcodeConfirmOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  /** resume keeps the camera open; close returns to the underlying screen. */
  next?: 'resume' | 'close' | 'keep';
}

export interface BarcodeCaptureHandle {
  focusInput(): void;
  openCamera(): void;
  resumeCamera(): void;
  reset(): void;
}

interface BarcodeCaptureProps {
  id: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  allowPacks?: boolean;
  autoOpenCamera?: boolean;
  disabled?: boolean;
  onConfirm(
    target: BarcodeConfirmationView,
    source: BarcodeScanSource,
    /** Stable across retries while this exact confirmation card is open. */
    confirmationId: string,
  ): Promise<BarcodeConfirmOutcome> | BarcodeConfirmOutcome;
}

type Phase = 'idle' | 'resolving' | 'ready' | 'confirming' | 'error' | 'success';

/**
 * One scanner UI for a keyboard-emulating HID scanner and a phone/tablet camera.
 *
 * The camera loop only resolves a code. It never receives an operation id,
 * quantity, or idempotency key, so recognition cannot mutate data. Decoding is
 * paused while a card/error is visible and resumes only after Scan Again or a
 * successful confirmed action.
 */
export const BarcodeCapture = forwardRef<BarcodeCaptureHandle, BarcodeCaptureProps>(
  function BarcodeCapture(
    {
      id,
      label = 'Barcode',
      placeholder = 'Ready to scan',
      confirmLabel,
      allowPacks = true,
      autoOpenCamera = false,
      disabled = false,
      onConfirm,
    },
    ref,
  ) {
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [source, setSource] = useState<BarcodeScanSource | null>(null);
    const [target, setTarget] = useState<BarcodeConfirmationView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showAllContents, setShowAllContents] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pausedRef = useRef(false);
    const resolvingRef = useRef(false);
    const confirmationIdRef = useRef<string | null>(null);
    const autoOpenedRef = useRef(false);
    const resolveRef = useRef<(barcode: string, scanSource: BarcodeScanSource) => void>(() => {});

    const focusInput = useCallback(() => {
      if (cameraOpen || disabled) return;
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }, [cameraOpen, disabled]);

    const reset = useCallback(() => {
      resolvingRef.current = false;
      pausedRef.current = false;
      setPhase('idle');
      setSource(null);
      setTarget(null);
      setError(null);
      setSuccess(null);
      setShowAllContents(false);
      confirmationIdRef.current = null;
      focusInput();
    }, [focusInput]);

    const closeCamera = useCallback(() => {
      setCameraOpen(false);
      setCameraReady(false);
      reset();
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
    }, [reset]);

    const openCamera = useCallback(() => {
      if (disabled) return;
      reset();
      setCameraOpen(true);
    }, [disabled, reset]);

    const resumeCamera = useCallback(() => {
      if (!cameraOpen) {
        openCamera();
        return;
      }
      reset();
    }, [cameraOpen, openCamera, reset]);

    useImperativeHandle(
      ref,
      () => ({ focusInput, openCamera, resumeCamera, reset }),
      [focusInput, openCamera, reset, resumeCamera],
    );

    useEffect(() => {
      if (!autoOpenCamera || autoOpenedRef.current) return;
      autoOpenedRef.current = true;
      openCamera();
    }, [autoOpenCamera, openCamera]);

    const resolveCode = useCallback(
      async (rawBarcode: string, scanSource: BarcodeScanSource) => {
        const barcode = rawBarcode.trim().toUpperCase();
        if (!barcode || resolvingRef.current || disabled) return;

        resolvingRef.current = true;
        pausedRef.current = true;
        setSource(scanSource);
        setPhase('resolving');
        setTarget(null);
        setError(null);
        setSuccess(null);

        try {
          const result = await resolveBarcodeServerAction(barcode);
          if (!result.ok) {
            setError(result.error);
            setPhase('error');
            return;
          }
          if (!allowPacks && result.data.kind === 'pack') {
            setError(`${result.data.name} is a pack — scan an individual item barcode`);
            setPhase('error');
            return;
          }
          confirmationIdRef.current = newClientEventId();
          setTarget(result.data);
          setPhase('ready');
        } catch {
          setError('Barcode could not be checked — verify the connection and scan again');
          setPhase('error');
        } finally {
          resolvingRef.current = false;
        }
      },
      [allowPacks, disabled],
    );

    resolveRef.current = (barcode, scanSource) => {
      void resolveCode(barcode, scanSource);
    };

    // Keep body and page behind the full-screen camera stationary on iOS.
    useEffect(() => {
      if (!cameraOpen) return;
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }, [cameraOpen]);

    // Camera setup and a central-region ZXing decode loop. getUserMedia with
    // facingMode=environment works in current Safari iOS/iPadOS and Chrome
    // Android; playsInline prevents iOS from taking the video full-screen.
    useEffect(() => {
      if (!cameraOpen) return;

      let stopped = false;
      let stream: MediaStream | null = null;
      let timer: number | null = null;

      const stop = () => {
        stopped = true;
        if (timer != null) window.clearTimeout(timer);
        stream?.getTracks().forEach((track) => track.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      };

      async function start() {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera scanning is not supported by this browser');
          setPhase('error');
          pausedRef.current = true;
          return;
        }

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
          if (stopped) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          await video.play();

          const [{ BrowserMultiFormatOneDReader }, { BarcodeFormat, DecodeHintType }] =
            await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatOneDReader(hints, {
            delayBetweenScanAttempts: 180,
            delayBetweenScanSuccess: 800,
          });

          setCameraReady(true);

          const tick = () => {
            if (stopped) return;
            const preview = videoRef.current;
            const canvas = canvasRef.current;
            if (!pausedRef.current && preview && canvas && preview.readyState >= 2) {
              const sourceWidth = preview.videoWidth;
              const sourceHeight = preview.videoHeight;
              if (sourceWidth > 0 && sourceHeight > 0) {
                // Decode only the middle guide area. This also reduces the work
                // per frame on high-resolution phone cameras.
                const cropWidth = Math.floor(sourceWidth * 0.9);
                const cropHeight = Math.floor(sourceHeight * 0.45);
                const cropX = Math.floor((sourceWidth - cropWidth) / 2);
                const cropY = Math.floor((sourceHeight - cropHeight) / 2);
                const outputWidth = Math.min(cropWidth, 1200);
                const outputHeight = Math.max(
                  1,
                  Math.floor((cropHeight / cropWidth) * outputWidth),
                );
                canvas.width = outputWidth;
                canvas.height = outputHeight;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (context) {
                  context.drawImage(
                    preview,
                    cropX,
                    cropY,
                    cropWidth,
                    cropHeight,
                    0,
                    0,
                    outputWidth,
                    outputHeight,
                  );
                  try {
                    const result = reader.decodeFromCanvas(canvas);
                    const text = result.getText().trim();
                    if (text) {
                      pausedRef.current = true;
                      resolveRef.current(text, 'camera');
                    }
                  } catch {
                    // "Not found in this frame" is the normal scanning state.
                  }
                }
              }
            }
            timer = window.setTimeout(tick, 180);
          };
          tick();
        } catch (cameraError) {
          const name = cameraError instanceof DOMException ? cameraError.name : '';
          const message =
            name === 'NotAllowedError'
              ? 'Camera access was denied. Allow camera access in browser settings and try again.'
              : name === 'NotReadableError'
                ? 'The camera is busy or unavailable. Close other camera apps and try again.'
                : 'The camera could not be started on this device.';
          setError(message);
          setPhase('error');
          pausedRef.current = true;
        }
      }

      void start();
      return stop;
    }, [cameraOpen]);

    async function confirm() {
      if (!target || !source || phase === 'confirming') return;
      setPhase('confirming');
      setError(null);
      try {
        const confirmationId = confirmationIdRef.current ?? newClientEventId();
        confirmationIdRef.current = confirmationId;
        const outcome = await onConfirm(target, source, confirmationId);
        if (!outcome.ok) {
          setError(outcome.error ?? 'The item was not saved');
          setPhase('ready');
          return;
        }

        const next = outcome.next ?? 'resume';
        if (next === 'keep') {
          setPhase('ready');
          return;
        }
        if (next === 'close') {
          closeCamera();
          return;
        }

        setSuccess(outcome.message ?? `${target.name} confirmed`);
        setPhase('success');
        window.setTimeout(reset, 700);
      } catch {
        setError('The item was not saved — check the connection and try again');
        setPhase('ready');
      }
    }

    const scanAgain = () => {
      if (cameraOpen && !cameraReady) {
        setCameraOpen(false);
        reset();
        window.setTimeout(() => setCameraOpen(true), 0);
        return;
      }
      reset();
    };
    const cancel = () => {
      if (source === 'camera' || cameraOpen) closeCamera();
      else reset();
    };

    const panel =
      phase === 'idle' && !target && !error && !success ? null : (
        <ConfirmationPanel
          phase={phase}
          target={target}
          error={error}
          success={success}
          confirmLabel={confirmLabel}
          showAllContents={showAllContents}
          onToggleContents={() => setShowAllContents((value) => !value)}
          onConfirm={() => void confirm()}
          onScanAgain={scanAgain}
          onCancel={cancel}
        />
      );

    return (
      <>
        <div className="app-card p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = inputRef.current;
              if (!input) return;
              const value = input.value;
              input.value = '';
              void resolveCode(value, 'hid');
            }}
          >
            <label htmlFor={id} className="text-base font-medium text-slate-700">
              {label}
            </label>
            <div className="mt-1 flex flex-col gap-3 sm:flex-row">
              <input
                id={id}
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="none"
                disabled={disabled || phase !== 'idle'}
                placeholder={placeholder}
                className="min-w-0 flex-1 rounded-xl border-2 border-slate-400 px-4 py-4 font-mono text-2xl disabled:bg-slate-100"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={openCamera}
                className="min-h-14 rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
              >
                Scan with Camera
              </button>
            </div>
            <p className="mt-2 text-base text-slate-600">
              Use the camera or scan with the USB/Bluetooth scanner. Nothing is added until you
              confirm.
            </p>
          </form>

          {source === 'hid' ? <div className="mt-4">{panel}</div> : null}
        </div>

        {cameraOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Camera barcode scanner"
            className="camera-surface fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-black"
          >
            {/*
             * Высота задана в dvh, а не через inset-0.
             *
             * На мобильных `position: fixed; inset: 0` растягивается по БОЛЬШОМУ
             * вьюпорту, то есть заходит под сворачиваемую панель браузера с
             * адресом. Из-за этого прижатые к низу кнопки оказывались за панелью
             * Safari, и нажать подтверждение было невозможно. `100dvh` считается
             * по видимой области и меняется вместе с панелью браузера.
             */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

            <div className="relative z-20 flex items-center justify-between gap-3 bg-black/72 p-4 text-white backdrop-blur-[2px]">
              <div>
                <p className="text-xl font-bold">Place one barcode inside the frame</p>
                <p className="text-sm text-white/80">
                  {cameraReady ? 'Hold the device steady' : 'Starting camera…'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCamera}
                className="min-h-12 rounded-xl bg-black/60 px-5 text-lg font-semibold ring-1 ring-white/50"
              >
                Cancel
              </button>
            </div>

            {/*
             * Рамка прицела в потоке, а не absolute: панель подтверждения встаёт
             * сразу под ней, а не у нижнего края экрана, где её накрывает браузер.
             */}
            <div className="pointer-events-none relative z-10 flex shrink-0 justify-center px-5">
              <div className="h-[30dvh] max-h-72 min-h-36 w-full max-w-2xl rounded-3xl border-4 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]" />
            </div>

            {phase !== 'idle' ? (
              <div className="relative z-20 mt-3 flex-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                {panel}
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  },
);

function ConfirmationPanel({
  phase,
  target,
  error,
  success,
  confirmLabel,
  showAllContents,
  onToggleContents,
  onConfirm,
  onScanAgain,
  onCancel,
}: {
  phase: Phase;
  target: BarcodeConfirmationView | null;
  error: string | null;
  success: string | null;
  confirmLabel: string;
  showAllContents: boolean;
  onToggleContents(): void;
  onConfirm(): void;
  onScanAgain(): void;
  onCancel(): void;
}) {
  if (phase === 'resolving') {
    return (
      <section className="app-card p-5 text-slate-900 shadow-[var(--shadow-raised)]">
        <p className="text-xl font-semibold">Checking barcode…</p>
        <p className="mt-1 text-base text-slate-600">No inventory has been changed.</p>
      </section>
    );
  }

  if (phase === 'success') {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl bg-emerald-100 p-5 text-emerald-950 shadow-2xl ring-2 ring-emerald-400"
      >
        <p className="text-2xl font-bold">{success}</p>
        <p className="mt-1 text-base">Ready for the next barcode…</p>
      </section>
    );
  }

  if (!target) {
    return (
      <section className="app-card border-red-300 p-5 text-slate-900 shadow-[var(--shadow-raised)] ring-1 ring-red-300">
        <p role="alert" className="text-xl font-bold text-red-800">
          {error ?? 'Barcode not found'}
        </p>
        <p className="mt-1 text-base text-slate-600">Nothing was added or changed.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onScanAgain}
            className="min-h-14 rounded-xl bg-slate-900 px-4 text-lg font-semibold text-white"
          >
            Scan Again
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-14 rounded-xl border-2 border-slate-400 px-4 text-lg font-semibold"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  const components = showAllContents ? target.components : target.components.slice(0, 3);
  const busy = phase === 'confirming';

  return (
    <section className="app-card p-5 text-slate-900 shadow-[var(--shadow-raised)]">
      <div className="flex items-start gap-4">
        <ItemPhoto photoUrl={target.photoUrl} name={target.name} size={76} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold break-words">{target.name}</h2>
            {target.kind === 'pack' ? (
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-900">
                Pack
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-base text-slate-600">Code: {target.internalCode}</p>
          {target.referenceNumber ? (
            <p className="text-base text-slate-600">Reference: {target.referenceNumber}</p>
          ) : null}
          {target.kind === 'item' ? (
            <p className="mt-2 text-xl">
              In stock: <strong>{target.currentQuantity}</strong>{' '}
              <span className="text-base text-slate-600">{target.unitOfMeasurement}</span>
            </p>
          ) : null}
        </div>
      </div>

      {target.kind === 'pack' ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="font-semibold">
            {target.components.length}{' '}
            {target.components.length === 1 ? 'item type' : 'item types'} in this pack
          </p>
          <ul className="mt-2 space-y-1">
            {components.map((component) => (
              <li key={component.itemId} className="flex justify-between gap-3 text-base">
                <span>{component.name}</span>
                <strong>
                  {component.quantity} {component.unitOfMeasurement}
                </strong>
              </li>
            ))}
          </ul>
          {target.components.length > 3 ? (
            <button
              type="button"
              onClick={onToggleContents}
              className="mt-2 min-h-11 font-semibold text-slate-700 underline underline-offset-4"
            >
              {showAllContents ? 'Hide Contents' : 'View Contents'}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2 font-semibold text-red-900">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          disabled={busy}
          onClick={onScanAgain}
          className="min-h-14 rounded-xl border-2 border-slate-400 px-4 text-lg font-semibold disabled:opacity-50"
        >
          Scan Again
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-14 rounded-xl bg-slate-900 px-4 text-lg font-semibold text-white disabled:opacity-60 sm:order-last"
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-14 rounded-xl border-2 border-slate-300 px-4 text-lg font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
