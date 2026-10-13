'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { DbEngine, DriverProp } from './types';

type Catalog = Record<DbEngine, DriverProp[]>;
let cached: Promise<Catalog> | null = null;

/** The properties each database driver takes. One request for the whole session: the list only changes with the server. */
export function useDriverProps(): Catalog | null {
  const [cat, setCat] = useState<Catalog | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= api.get<Catalog>('/object-db/props').catch((e) => { cached = null; throw e; });
    cached.then((c) => { if (live) setCat(c); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return cat;
}
