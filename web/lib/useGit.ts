'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useHive } from './store';
import type { Agent, GitStatus, GitTree } from './types';

/**
 * Status (cheap, drives the "Changes" badge) and file tree (loaded when the explorer is open) for an agent's folder.
 * Both refresh when the agent finishes a turn, and status polls while the agent is working and the explorer is open.
 */
export function useGit(agent: Agent | undefined, active: boolean) {
  const { finished } = useHive();
  const id = agent?.id ?? '';
  const fin = finished[id] ?? 0;
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [tree, setTree] = useState<GitTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const cwd = agent?.effective.cwd ?? '';
  const running = agent?.status === 'running';

  const load = useCallback(async (withTree: boolean) => {
    if (!id) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api.get<GitStatus>(`/agents/${id}/git/status`),
        withTree ? api.get<GitTree>(`/agents/${id}/git/tree`) : Promise.resolve(null),
      ]);
      if (my !== seq.current) return;
      setStatus(s); if (t) setTree(t); setError(null);
    } catch (e) { if (my === seq.current) setError(e instanceof Error ? e.message : 'error'); }
    finally { if (my === seq.current) setLoading(false); }
  }, [id]);

  // New folder (e.g. the colony's folder changed) → forget what we had.
  useEffect(() => { setTree(null); setStatus(null); }, [cwd]);
  useEffect(() => { void load(active); }, [load, active, fin, cwd]);
  useEffect(() => {
    if (!active || !running) return;
    const i = setInterval(() => void load(true), 5000);
    return () => clearInterval(i);
  }, [active, running, load]);

  return { status, tree, loading, error, refresh: useCallback(() => load(true), [load]) };
}
