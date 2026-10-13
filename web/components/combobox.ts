import { useId } from 'react';

/**
 * The ARIA wiring of a combobox with a listbox (the input keeps the focus, the highlighted option is announced through aria-activedescendant).
 * Spread `input` on the input, `listProps` on the listbox element, and give each option `optionProps(i)`. Ids come from useId, so two pickers never clash,
 * and the input only points to the list while it exists.
 */
export function useCombobox(open: boolean, active: number, count: number) {
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (i: number) => `${base}-opt-${i}`;
  return {
    input: {
      role: 'combobox' as const, 'aria-autocomplete': 'list' as const, 'aria-haspopup': 'listbox' as const, 'aria-expanded': open,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open && count > 0 && active >= 0 && active < count ? optionId(active) : undefined,
    },
    listProps: { id: listId, role: 'listbox' as const },
    optionProps: (i: number) => ({ id: optionId(i), role: 'option' as const, 'aria-selected': i === active }),
  };
}
