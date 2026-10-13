import type { ReactNode } from 'react';

/**
 * The list-and-detail layout the resource screens share (HTTP requests, database schema): a list column at the left, the detail at the right.
 * On a narrow screen they stack, the list capped to a share of the height so the detail keeps room. `gap` separates two cards instead of one divider;
 * `listWidth` is a CSS track size (default `minmax(260px, 340px)`).
 */
export function MasterDetail({ list, children, gap = false, listWidth }: { list: ReactNode; children: ReactNode; gap?: boolean; listWidth?: string }) {
  return (
    <div className={`msd ${gap ? 'msd-gap' : ''}`} style={listWidth ? { ['--msd-list' as never]: listWidth } : undefined}>
      {list}
      {children}
    </div>
  );
}
