'use client';
import { Check } from 'lucide-react';

/** A checklist of agents (team of an orchestrator, members of a colony): the same rows wherever a set of agents is chosen. */
export function MemberPick({ items, value, onChange }: { items: { id: string; name: string; note: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="skillpick">
      {items.map((it) => {
        const on = value.includes(it.id);
        return (
          <button key={it.id} type="button" className="skillrow" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== it.id) : [...value, it.id])}>
            <span className="check">{on && <Check size={13} strokeWidth={3} />}</span>
            <span><b className="fw-600">{it.name}</b><span className="hint hint-block">{it.note}</span></span>
          </button>
        );
      })}
    </div>
  );
}
