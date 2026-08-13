-- Новое дополнение к ТЗ: пределы одновременно активных операций.
--
--  1) у одного врача не больше ОДНОЙ активной операции: следующую он начинает
--     только после Finish предыдущей;
--  2) активных операций всего не больше двух — в клинике два операционных
--     кабинета, и третья одновременная операция физически невозможна.
--
-- Это ограничения БД, а не только проверки в коде: §21.1 требует, чтобы
-- недопустимое состояние нельзя было записать даже прямой вставкой, а два
-- параллельных запроса «создать операцию» иначе прошли бы оба.
--
-- Частичный уникальный индекс исключает операции без врача: записи, созданные
-- до появления справочника, имеют doctor_id IS NULL, и их несколько.
--
-- ЕСЛИ МИГРАЦИЯ ПАДАЕТ с «UNIQUE constraint failed: operations.doctor_id» —
-- в базе уже есть врач с двумя незакрытыми операциями. Автоматически закрыть
-- лишние миграция не имеет права: какая из них настоящая, знает только клиника.
-- Найти их и завершить или аннулировать вручную, затем повторить миграцию:
--
--   SELECT doctor_id, group_concat(case_code) FROM operations
--    WHERE status = 'Active' AND doctor_id IS NOT NULL
--    GROUP BY doctor_id HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX ux_operations_single_active_per_doctor
  ON operations (doctor_id)
  WHERE status = 'Active' AND doctor_id IS NOT NULL;

-- Предел «двух кабинетов» не выражается индексом — он про количество строк,
-- а не про уникальность, поэтому это триггер.
CREATE TRIGGER trg_operations_room_limit_insert
BEFORE INSERT ON operations
WHEN NEW.status = 'Active'
  AND (SELECT COUNT(*) FROM operations WHERE status = 'Active') >= 2
BEGIN
  SELECT RAISE(ABORT, 'both operating rooms are already in use');
END;

-- Обратного перехода в Active в системе нет (§9.1, §18.13), но если он когда-то
-- появится, предел обязан действовать и там.
CREATE TRIGGER trg_operations_room_limit_update
BEFORE UPDATE OF status ON operations
WHEN NEW.status = 'Active'
  AND OLD.status <> 'Active'
  AND (SELECT COUNT(*) FROM operations WHERE status = 'Active' AND id <> NEW.id) >= 2
BEGIN
  SELECT RAISE(ABORT, 'both operating rooms are already in use');
END;
