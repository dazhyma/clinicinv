/**
 * Звуковой сигнал скана (§7.5, шаг 6: «если это поддерживается устройством»).
 *
 * Тон синтезируется Web Audio API, а не берётся из файла: лишний запрос за
 * ассетом в момент скана — это задержка на пути, у которого бюджет 500 мс
 * (§14.3), плюс звук должен работать и при мгновенном повторе.
 *
 * Успех и ошибка звучат ОТЧЁТЛИВО по-разному (высокий короткий против низкого
 * длинного): в операционной на экран смотрят не всегда, а §7.5 требует
 * различимого результата скана.
 *
 * Любая ошибка подавляется: отсутствие Web Audio или запрет автовоспроизведения
 * не должны ронять экран, за которым идёт операция.
 */
type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (context) return context;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

export type ScanSound = 'ok' | 'error';

export function playScanSound(kind: ScanSound, enabled: boolean): void {
  if (!enabled) return;

  const ctx = audioContext();
  if (!ctx) return;

  try {
    // Браузер приостанавливает контекст до жеста пользователя; скан в поле
    // ввода таким жестом является, поэтому resume() обычно проходит сразу.
    if (ctx.state === 'suspended') void ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const duration = kind === 'ok' ? 0.09 : 0.32;

    oscillator.type = kind === 'ok' ? 'sine' : 'square';
    oscillator.frequency.setValueAtTime(kind === 'ok' ? 1320 : 220, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'ok' ? 0.18 : 0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  } catch {
    // Звук — вспомогательный канал (§7.5). Молча обходимся без него.
  }
}
