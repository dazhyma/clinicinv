'use client';

import { useEffect } from 'react';

const WARNING = 'You have unsaved changes. Leave this page and discard them?';

/**
 * Предупреждение о несохранённых данных из нового ТЗ.
 *
 * `beforeunload` закрывает обновление/закрытие вкладки, а перехват ссылок —
 * обычную навигацию внутри приложения. После сохранения владелец формы снимает
 * `dirty`, поэтому подтверждение не появляется на штатном переходе.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }

      if (!window.confirm(WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [dirty]);
}
