'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  ItemSearchResultView,
  OperationMutationResult,
  OperationStateView,
} from '@/actions/operations';
import type { ActionResult } from '@/actions/result';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import { newClientEventId } from '../../_components/client-event-id';
import {
  BarcodeCapture,
  type BarcodeCaptureHandle,
  type BarcodeConfirmOutcome,
} from '../../_components/barcode-capture';
import {
  addItemAction,
  changeLineQuantityServerAction,
  finishOperationServerAction,
  scanBarcodeAction,
  undoLastScanServerAction,
} from '../actions';
import { ManualSearchDialog } from './manual-search';
import { playScanSound } from './scan-sound';
import { VoidOperationButton } from './void-dialog';

/**
 * Экран активной операции (§7.4–§7.10, §8.1–§8.4, §9.2, §14.2–§14.4).
 *
 * Три правила определяют устройство этого файла:
 *
 * 1) НИЧЕГО не хранится только на странице (§8.1, §18.11). Каждое действие
 *    немедленно уходит на сервер, и источником истины остаётся ответ сервера:
 *    состояние заменяется присланным целиком, а не «досчитывается» на клиенте.
 *    Поэтому refresh, закрытие вкладки, logout и перезапуск сервера ничего не
 *    теряют — терять на клиенте попросту нечего.
 *
 * 2) Распознавание и добавление — два разных шага. Камера или HID-сканер сначала
 *    выполняют только read-only lookup и показывают карточку. Идентификатор
 *    события, оптимистичная строка и серверная мутация появляются только после
 *    явного Add. Закрытие карточки/страницы не может списать остаток.
 *
 * 3) Каждое действие несёт `clientEventId`, сгенерированный здесь, на клиенте
 *    (§10.4, §16). Двойное срабатывание сканера, ретрай после таймаута и
 *    повторная отправка не списывают предмет дважды — ключ проверяется
 *    уникальным индексом БД.
 *
 * HID-поле сканирования готово постоянно (§7.5), а камера использует ту же
 * карточку подтверждения. После успешного Add камера остаётся открытой и
 * возвращается к распознаванию следующего штрихкода.
 */

interface OptimisticLine {
  key: string;
  itemId: number;
  name: string;
  unitOfMeasurement: string;
  quantity: number;
  packName: string | null;
}

interface PendingEntry {
  clientEventId: string;
  label: string;
  lines: OptimisticLine[];
}

interface DisplayLine {
  key: string;
  lineId: number | null;
  itemId: number;
  name: string;
  internalCode: string | null;
  unitOfMeasurement: string;
  quantity: number;
  packName: string | null;
  fromPack: boolean;
  unitCostFormatted?: string;
  lineTotalFormatted?: string;
  syncing: boolean;
}

type FeedbackTone = 'pending' | 'ok' | 'error';

interface Feedback {
  id: number;
  tone: FeedbackTone;
  title: string;
  detail?: string;
  warnings: string[];
}

const TONE_STYLES: Record<FeedbackTone, string> = {
  // §7.5/§14.2: успех — зелёный, ошибка — красный. Промежуточное состояние
  // намеренно нейтральное: зелёный до ответа сервера был бы обещанием, которое
  // система ещё не может дать.
  pending: 'bg-slate-100 text-slate-800 ring-slate-300',
  ok: 'bg-emerald-100 text-emerald-950 ring-emerald-400',
  error: 'bg-red-100 text-red-950 ring-red-400',
};

export function OperationScreen({
  initialState,
  soundEnabled,
  isAdmin,
}: {
  initialState: OperationStateView;
  soundEnabled: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  /** Оптимистичные количества строк: id строки → количество (0 = удалена). */
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [offline, setOffline] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const scannerRef = useRef<BarcodeCaptureHandle>(null);
  const finishButtonRef = useRef<HTMLButtonElement>(null);
  const dialogOpenRef = useRef(false);
  const feedbackId = useRef(0);
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  /** Кнопка мыши/палец сейчас нажаты: фокус в этот момент трогать нельзя. */
  const pointerDownRef = useRef(false);
  /** Возврат фокуса отложен до отпускания указателя. */
  const focusDeferredRef = useRef(false);
  /** Защита от повторного входа в confirmFinish (кнопка + двойной клик). */
  const finishingRef = useRef(false);

  // --- Фокус: поле сканирования готово постоянно (§7.5) ---------------------

  /**
   * Возврат фокуса в поле сканирования.
   *
   * Исключение первое — открытый диалог: иначе поле причины Void или строка
   * ручного поиска теряли бы фокус после каждого нажатия, и набрать в них текст
   * было бы невозможно. Проверка идёт по `[role="dialog"]`, а не по одному
   * флагу: диалогов на экране несколько, и открывают их разные компоненты.
   *
   * Исключение второе — указатель сейчас нажат. Между `mousedown` и `mouseup`
   * страницу трогать нельзя: если под курсором что-то сдвинется, браузер не
   * выдаст `click` вообще, и нажатие пропадёт молча.
   *
   * `preventScroll: true` обязателен и является сутью исправления дефекта
   * «Finish and Lock — тихий no-op». Поле сканирования находится вверху экрана;
   * когда пользователь тянется к кнопке внизу списка позиций, поле уже уехало
   * за верхнюю границу окна. `focus()` со скроллом по умолчанию возвращает его
   * в видимую область — страница прыгает на сотни пикселей ПОСЛЕ нажатия
   * кнопки мыши и ДО её отпускания, кнопка уходит из-под курсора, и `click` не
   * происходит. Воспроизведено в Chrome: кнопка Finish Operation уезжала с
   * y=397 на y=1154 за 140 мс удержания. Фокус нужен полю (§7.5), прокрутка —
   * нет.
   */
  const focusScanner = useCallback(() => {
    if (dialogOpenRef.current) return;
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('[role="dialog"]')) return;
    }
    if (pointerDownRef.current) {
      focusDeferredRef.current = true;
      return;
    }
    scannerRef.current?.focusInput();
  }, []);

  useEffect(() => {
    focusScanner();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') focusScanner();
    };
    const onPointerDown = () => {
      pointerDownRef.current = true;
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      if (!focusDeferredRef.current) return;
      focusDeferredRef.current = false;
      // Через таймер, а не сразу: `click` рассылается в том же такте, что и
      // `pointerup`, и обработчик кнопки должен отработать раньше фокуса.
      window.setTimeout(focusScanner, 0);
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [focusScanner]);

  /**
   * Фокус переезжает на кнопку подтверждения, как только диалог открыт.
   *
   * `preventScroll` здесь по той же причине, что и в focusScanner: страница под
   * диалогом прокручена, и любой прыжок содержимого во время нажатия отменяет
   * `click`. Фокус внутри диалога вдобавок глушит возврат фокуса в поле
   * сканирования (проверка `[role="dialog"]`), даже если флаг диалога кто-то
   * забудет выставить.
   */
  useEffect(() => {
    if (!finishOpen) return;
    finishButtonRef.current?.focus({ preventScroll: true });
  }, [finishOpen]);

  // --- Связь (§8.4, минимум для MVP) ----------------------------------------

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // --- Общая механика мутации ------------------------------------------------

  const showFeedback = useCallback((next: Omit<Feedback, 'id'>) => {
    feedbackId.current += 1;
    setFeedback({ ...next, id: feedbackId.current });
  }, []);

  /**
   * Применяет серверное состояние, если оно не устарело.
   *
   * Сканы идут быстрее, чем приходят ответы, и ответ на более ранний запрос
   * может прийти позже. Без этой проверки он вернул бы список к прошлому
   * состоянию — пользователь увидел бы, как позиция «пропала».
   */
  const applyState = useCallback((seq: number, next: OperationStateView) => {
    if (seq <= appliedSeq.current) return;
    appliedSeq.current = seq;
    setState(next);
  }, []);

  const runMutation = useCallback(
    async (options: {
      entry: PendingEntry | null;
      /** Что откатится, если сервер откажет: показывается пользователю. */
      rollbackLabel: string;
      lineOverrides?: Record<number, number>;
      call: () => Promise<ActionResult<OperationMutationResult>>;
    }) => {
      const seq = (requestSeq.current += 1);
      if (options.entry) setPending((list) => [...list, options.entry as PendingEntry]);
      if (options.lineOverrides) {
        setOverrides((current) => ({ ...current, ...options.lineOverrides }));
      }

      try {
        const result = await options.call();

        if (result.ok) {
          applyState(seq, result.data.state);
          setUnsynced(0);
          const warnings = result.data.warnings.map((warning) => warning.message);
          showFeedback({
            tone: 'ok',
            title: result.data.message,
            detail: result.data.applied ? undefined : 'Already recorded — nothing was added twice',
            warnings,
          });
          playScanSound(warnings.length ? 'error' : 'ok', soundEnabled);
        } else {
          // §14.4: сообщение сервера дословно + что именно откатилось.
          showFeedback({
            tone: 'error',
            title: result.error,
            detail: `${options.rollbackLabel} was not saved`,
            warnings: [],
          });
          playScanSound('error', soundEnabled);
        }
        return result;
      } catch {
        // Сервер недоступен: ничего не сохранено и локальной очереди нет (§20 —
        // полноценный offline вне MVP). Пользователь обязан это видеть (§8.4).
        setUnsynced((count) => count + 1);
        showFeedback({
          tone: 'error',
          title: 'Changes are not synced — check connection',
          detail: `${options.rollbackLabel} was not saved. Check the connection and try again.`,
          warnings: [],
        });
        playScanSound('error', soundEnabled);
        return {
          ok: false as const,
          error: 'Changes are not synced — check connection',
          code: 'UNEXPECTED' as const,
        };
      } finally {
        if (options.entry) {
          setPending((list) => list.filter((item) => item.clientEventId !== options.entry?.clientEventId));
        }
        if (options.lineOverrides) {
          setOverrides((current) => {
            const next = { ...current };
            for (const key of Object.keys(options.lineOverrides ?? {})) delete next[Number(key)];
            return next;
          });
        }
        focusScanner();
      }
    },
    [applyState, focusScanner, showFeedback, soundEnabled],
  );

  // --- Скан (§7.5) -----------------------------------------------------------

  const confirmScannedTarget = useCallback(
    async (
      known: BarcodeConfirmationView,
      _source: 'camera' | 'hid',
      clientEventId: string,
    ): Promise<BarcodeConfirmOutcome> => {
      const optimisticLines: OptimisticLine[] =
        known.kind === 'pack'
          ? known.components.map((component) => ({
              key: `${clientEventId}:${component.itemId}`,
              itemId: component.itemId,
              name: component.name,
              unitOfMeasurement: component.unitOfMeasurement,
              quantity: component.quantity,
              packName: known.name,
            }))
          : [
              {
                key: `${clientEventId}:${known.id}`,
                itemId: known.id,
                name: known.name,
                unitOfMeasurement: known.unitOfMeasurement ?? '',
                quantity: 1,
                packName: null,
              },
            ];

      showFeedback({
        tone: 'pending',
        title: `${known.name} — saving…`,
        warnings: [],
      });

      const result = await runMutation({
        entry: { clientEventId, label: known.name, lines: optimisticLines },
        rollbackLabel: known.name,
        call: () =>
          scanBarcodeAction({
            operationId: state.id,
            barcode: known.barcode,
            clientEventId,
          }),
      });

      return result.ok
        ? { ok: true, message: result.data.message, next: 'resume' }
        : { ok: false, error: result.error };
    },
    [runMutation, showFeedback, state.id],
  );

  // --- Ручное добавление (§7.8) ---------------------------------------------

  const handleManualPick = useCallback(
    (item: ItemSearchResultView) => {
      const clientEventId = newClientEventId();
      dialogOpenRef.current = false;
      setManualOpen(false);

      showFeedback({ tone: 'pending', title: `${item.name} — saving…`, warnings: [] });

      void runMutation({
        entry: {
          clientEventId,
          label: item.name,
          lines: [
            {
              key: `${clientEventId}:${item.itemId}`,
              itemId: item.itemId,
              name: item.name,
              unitOfMeasurement: item.unitOfMeasurement,
              quantity: 1,
              packName: null,
            },
          ],
        },
        rollbackLabel: item.name,
        call: () =>
          addItemAction({
            operationId: state.id,
            itemId: item.itemId,
            quantity: 1,
            clientEventId,
          }),
      });
    },
    [runMutation, showFeedback, state.id],
  );

  // --- Исправления (§7.9) ----------------------------------------------------

  const changeQuantity = useCallback(
    (line: DisplayLine, nextQuantity: number) => {
      if (line.lineId == null || nextQuantity < 0) return;
      const clientEventId = newClientEventId();

      void runMutation({
        entry: null,
        rollbackLabel: line.name,
        lineOverrides: { [line.lineId]: nextQuantity },
        call: () =>
          changeLineQuantityServerAction({
            operationId: state.id,
            lineId: line.lineId as number,
            quantity: nextQuantity,
            clientEventId,
          }),
      });
    },
    [runMutation, state.id],
  );

  const undoLastScan = useCallback(() => {
    const clientEventId = newClientEventId();
    showFeedback({ tone: 'pending', title: 'Undoing last scan…', warnings: [] });
    void runMutation({
      entry: null,
      rollbackLabel: 'Undo',
      call: () => undoLastScanServerAction({ operationId: state.id, clientEventId }),
    });
  }, [runMutation, showFeedback, state.id]);

  // --- Finish and Lock (§9.2) ------------------------------------------------

  /**
   * Finish and Lock (§9.2).
   *
   * Кнопка фиксирует деньги и количества, поэтому у неё ровно два исхода:
   * операция завершена или на экране конкретная причина отказа (§14.4).
   * Молчаливого «ничего не произошло» быть не может:
   *
   *  - повторный вход защищён ref'ом, а не только `disabled`: состояние React
   *    применяется асинхронно, и два быстрых нажатия успевают пройти оба;
   *  - ошибка показывается ВНУТРИ диалога, а не только баннером наверху экрана:
   *    баннер в этот момент почти наверняка выше границы окна, и пользователь
   *    решил бы, что нажатие пропало;
   *  - при отказе диалог остаётся открытым — повторить действие можно сразу;
   *  - успех отмечается баннером ДО перехода: если переход почему-то не
   *    состоится, экран всё равно не окажется в неопределённом состоянии.
   */
  async function confirmFinish() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(null);
    try {
      const result = await finishOperationServerAction(state.id);
      if (!result.ok) {
        setFinishError(result.error);
        showFeedback({ tone: 'error', title: result.error, warnings: [] });
        playScanSound('error', soundEnabled);
        return;
      }
      showFeedback({
        tone: 'ok',
        title: `Operation ${result.data.caseCode} is finished`,
        detail: 'Quantities and costs are locked.',
        warnings: [],
      });
      router.push(`/operations?finished=${encodeURIComponent(result.data.caseCode)}`);
    } catch {
      setUnsynced((count) => count + 1);
      setFinishError('The operation was not finished and is still Active — check connection.');
      showFeedback({
        tone: 'error',
        title: 'Changes are not synced — check connection',
        detail: 'The operation was not finished and is still Active.',
        warnings: [],
      });
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }

  // --- Производное представление --------------------------------------------

  const displayLines = useMemo<DisplayLine[]>(() => {
    const rows: DisplayLine[] = state.lines
      .map((line) => ({
        key: `line-${line.id}`,
        lineId: line.id,
        itemId: line.itemId,
        name: line.name,
        internalCode: line.internalCode,
        unitOfMeasurement: line.unitOfMeasurement,
        quantity: overrides[line.id] ?? line.quantity,
        packName: line.sourcePackName,
        fromPack: line.sourceType === 'pack',
        unitCostFormatted: line.unitCostFormatted,
        lineTotalFormatted: line.lineTotalFormatted,
        syncing: overrides[line.id] !== undefined,
      }))
      .filter((line) => line.quantity > 0);

    for (const entry of pending) {
      for (const optimistic of entry.lines) {
        const existing = rows.find(
          (row) =>
            row.itemId === optimistic.itemId &&
            row.fromPack === (optimistic.packName != null) &&
            (optimistic.packName == null || row.packName === optimistic.packName),
        );
        if (existing) {
          existing.quantity += optimistic.quantity;
          existing.syncing = true;
          existing.lineTotalFormatted = undefined;
        } else {
          rows.push({
            key: optimistic.key,
            lineId: null,
            itemId: optimistic.itemId,
            name: optimistic.name,
            internalCode: null,
            unitOfMeasurement: optimistic.unitOfMeasurement,
            quantity: optimistic.quantity,
            packName: optimistic.packName,
            fromPack: optimistic.packName != null,
            syncing: true,
          });
        }
      }
    }

    return rows;
  }, [overrides, pending, state.lines]);

  const displayUnits = displayLines.reduce((sum, line) => sum + line.quantity, 0);
  const savingCount = pending.length + Object.keys(overrides).length;

  function openDialog(open: () => void) {
    dialogOpenRef.current = true;
    open();
  }

  function closeDialog(close: () => void) {
    dialogOpenRef.current = false;
    close();
    focusScanner();
  }

  return (
    <div
      className="flex flex-col gap-4"
      onClick={(event) => {
        // Возврат фокуса после любого касания экрана: пользователь не должен
        // нажимать в поле перед сканированием (§7.5). Нажатия внутри диалога
        // исключены — там фокус принадлежит полям диалога.
        if ((event.target as HTMLElement).closest('[role="dialog"]')) return;
        window.setTimeout(focusScanner, 0);
      }}
    >
      {/* --- Шапка операции (§7.4) --- */}
      <section className="app-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-base text-slate-600">Case</p>
          <p className="font-mono text-3xl font-bold tracking-wider">{state.caseCode}</p>
          {state.procedureCategory ? (
            <p className="text-base text-slate-600">{state.procedureCategory}</p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-emerald-100 px-4 py-2 text-lg font-semibold text-emerald-900">
            Active
          </span>
          <p className="text-lg text-slate-700">
            {state.itemCount} items · {displayUnits} units
          </p>
          {state.totalCostFormatted ? (
            <p className="text-lg font-semibold">Total: {state.totalCostFormatted}</p>
          ) : null}
        </div>
      </section>

      {/* --- Индикатор сохранения и связи (§7.4, §8.4, §14.4) --- */}
      <SyncIndicator offline={offline} saving={savingCount} unsynced={unsynced} />

      {/* --- Последний отсканированный предмет (§7.4, §7.5) --- */}
      <section
        aria-live="polite"
        className={`min-h-24 rounded-2xl px-5 py-5 ring-2 ${
          feedback ? TONE_STYLES[feedback.tone] : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        {feedback ? (
          <>
            <p className="text-3xl font-bold break-words">{feedback.title}</p>
            {feedback.detail ? <p className="mt-1 text-lg">{feedback.detail}</p> : null}
            {feedback.warnings.map((warning) => (
              <p key={warning} className="mt-2 rounded-lg bg-amber-200 px-3 py-2 text-lg font-semibold text-amber-950">
                {warning}
              </p>
            ))}
          </>
        ) : (
          <p className="text-2xl">Scan an item or pack barcode to begin.</p>
        )}
      </section>

      {/* Распознавание ничего не списывает: Add создаёт отдельное событие. */}
      <BarcodeCapture
        ref={scannerRef}
        id="operation-scan-input"
        confirmLabel="Add"
        onConfirm={confirmScannedTarget}
      />

      {/* --- Исправления (§7.9, §14.2: Undo всегда виден) --- */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={undoLastScan}
          className="flex-1 rounded-xl border-2 border-slate-900 px-6 py-4 text-lg font-semibold"
        >
          Undo Last Scan
        </button>
        <button
          type="button"
          onClick={() => openDialog(() => setManualOpen(true))}
          className="flex-1 rounded-xl border-2 border-slate-900 px-6 py-4 text-lg font-semibold"
        >
          Manual Item Search
        </button>
      </div>

      {/* --- Список добавленных позиций (§7.4, §7.7) --- */}
      <section className="app-card p-4">
        <h2 className="mb-3 text-xl font-semibold">Items in this operation</h2>
        {displayLines.length === 0 ? (
          <p className="text-lg text-slate-600">Nothing scanned yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {displayLines.map((line) => (
              <li
                key={line.key}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                  line.syncing ? 'border-slate-400 bg-slate-50' : 'border-slate-200'
                }`}
              >
                <div className="min-w-40 flex-1">
                  <p className="text-xl font-semibold">{line.name}</p>
                  <p className="text-base text-slate-600">
                    {line.internalCode ? <span className="font-mono">{line.internalCode}</span> : null}
                    {line.unitCostFormatted ? ` · ${line.unitCostFormatted} / ${line.unitOfMeasurement}` : ''}
                    {line.lineTotalFormatted ? ` · ${line.lineTotalFormatted}` : ''}
                  </p>
                  {line.fromPack ? (
                    <span className="mt-1 inline-block rounded-full bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-900">
                      From pack{line.packName ? `: ${line.packName}` : ''}
                    </span>
                  ) : null}
                  {line.syncing ? (
                    <span className="mt-1 ml-2 inline-block rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
                      Saving…
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease ${line.name}`}
                    disabled={line.lineId == null}
                    onClick={() => changeQuantity(line, line.quantity - 1)}
                    className="h-14 w-14 rounded-xl border-2 border-slate-400 text-2xl font-bold disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-12 text-center text-2xl font-bold">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${line.name}`}
                    disabled={line.lineId == null}
                    onClick={() => changeQuantity(line, line.quantity + 1)}
                    className="h-14 w-14 rounded-xl border-2 border-slate-400 text-2xl font-bold disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    disabled={line.lineId == null}
                    onClick={() => changeQuantity(line, 0)}
                    className="h-14 rounded-xl border-2 border-red-300 px-4 text-lg font-semibold text-red-800 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Finish визуально отделён от обычных действий (§14.2) --- */}
      <section className="app-card mt-2 border-[var(--color-primary)] p-4">
        <button
          type="button"
          onClick={() =>
            openDialog(() => {
              setFinishError(null);
              setFinishOpen(true);
            })
          }
          className="w-full rounded-xl bg-slate-900 px-6 py-5 text-2xl font-bold text-white"
        >
          Finish Operation
        </button>
        <p className="mt-2 text-base text-slate-600">
          The operation stays Active until you confirm. Nothing finishes on a timer.
        </p>
      </section>

      {isAdmin ? (
        <section className="rounded-2xl border border-red-200 bg-white p-4">
          <VoidOperationButton
            operationId={state.id}
            caseCode={state.caseCode}
            redirectTo={`/operations?voided=${encodeURIComponent(state.caseCode)}`}
            variant="block"
          />
        </section>
      ) : null}

      <p className="text-center">
        <Link href="/operations" className="text-lg text-slate-600 underline underline-offset-4">
          All operations
        </Link>
      </p>

      <ManualSearchDialog
        open={manualOpen}
        onClose={() => closeDialog(() => setManualOpen(false))}
        onPick={handleManualPick}
      />

      {/*
        §9.2: ровно одно подтверждение, текст дословно из ТЗ.

        Диалог намеренно НЕ обёрнут в <form>: обе кнопки — `type="button"`, и ни
        одно нажатие внутри него не может стать неявной отправкой формы. Кнопка
        подтверждения получает фокус при открытии — тогда её можно нажать с
        клавиатуры, а правило «фокус всегда в поле сканирования» (§7.5) само
        отключается проверкой `[role="dialog"]` в focusScanner.
      */}
      {finishOpen ? (
        <div
          className="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !finishing) closeDialog(() => setFinishOpen(false));
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Finish this operation?"
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 className="text-2xl font-semibold">Finish this operation?</h2>
            <p className="mt-3 text-lg text-slate-700">Quantities and costs will be locked.</p>

            {/* §14.4: причина отказа стоит рядом с кнопкой, а не только в
                баннере наверху экрана, который в этот момент вне окна. */}
            {finishError ? (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">
                {finishError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={finishing}
                onClick={() => closeDialog(() => setFinishOpen(false))}
                className="rounded-xl border border-slate-300 px-6 py-4 text-lg font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={finishButtonRef}
                disabled={finishing}
                onClick={confirmFinish}
                className="rounded-xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white disabled:opacity-60"
              >
                {finishing ? 'Locking…' : 'Finish and Lock'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Индикатор сохранения и синхронизации (§7.4, §8.4, §14.4).
 *
 * Полноценный offline-режим — раздел 20 ТЗ и в MVP не входит: локальной очереди
 * с досылкой здесь нет. Минимум §8.4 выполняется буквально: виден статус
 * Offline и число несинхронизированных действий, а не тишина.
 */
function SyncIndicator({
  offline,
  saving,
  unsynced,
}: {
  offline: boolean;
  saving: number;
  unsynced: number;
}) {
  const waiting = saving + unsynced;

  if (offline) {
    return (
      <p role="status" className="rounded-xl bg-red-100 px-4 py-3 text-lg font-semibold text-red-900 ring-1 ring-red-300">
        {waiting > 0
          ? `Offline — ${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting to sync`
          : 'Offline — scans will not be saved until the connection returns'}
      </p>
    );
  }

  if (unsynced > 0) {
    return (
      <p role="alert" className="rounded-xl bg-red-100 px-4 py-3 text-lg font-semibold text-red-900 ring-1 ring-red-300">
        Changes are not synced — check connection ({unsynced} not saved)
      </p>
    );
  }

  if (saving > 0) {
    return (
      <p role="status" className="rounded-xl bg-slate-200 px-4 py-3 text-lg font-semibold text-slate-800">
        Saving {saving} {saving === 1 ? 'change' : 'changes'}…
      </p>
    );
  }

  return (
    <p role="status" className="rounded-xl bg-emerald-100 px-4 py-3 text-lg font-semibold text-emerald-900">
      All changes saved
    </p>
  );
}
