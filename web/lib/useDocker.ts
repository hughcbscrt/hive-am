'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { whenAvailable } from './dockerLists';

export interface DockerContainer { id: string; name: string; image: string; state: string; status: string; ports: string; managed: boolean; mounts: string[]; networks: string[] }
export interface DockerImage { ref: string; id: string; size: string; created: string; inUse: number }
export interface DockerVolume { name: string; driver: string; anonymous: boolean; managed: boolean; inUse: number }
export interface DockerNetwork { name: string; id: string; driver: string; scope: string; builtin: boolean; managed: boolean; inUse: number }

/** What Docker has on this machine, loaded when `enabled` (a form that needs it is open) and again on `reload`. */
export function useDockerLists(enabled: boolean) {
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [images, setImages] = useState<DockerImage[] | null>(null);
  const [volumes, setVolumes] = useState<DockerVolume[] | null>(null);
  const [networks, setNetworks] = useState<DockerNetwork[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    api.get<{ available: boolean; error?: string; containers: DockerContainer[] }>('/docker/containers').then((r) => { if (dead) return; setContainers(r.containers); setError(r.available ? '' : r.error ?? 'unavailable'); }).catch(() => !dead && setError('unavailable'));
    api.get<{ available: boolean; images: DockerImage[] }>('/docker/images').then((r) => !dead && setImages(r.images)).catch(() => undefined);
    // Without Docker these stay null (not empty): a volume or a network cannot be said to be missing. The containers' error is the one notice.
    api.get<{ available: boolean; volumes: DockerVolume[] }>('/docker/volumes').then((r) => !dead && setVolumes(whenAvailable(r, r.volumes))).catch(() => !dead && setVolumes(null));
    api.get<{ available: boolean; networks: DockerNetwork[] }>('/docker/networks').then((r) => !dead && setNetworks(whenAvailable(r, r.networks))).catch(() => !dead && setNetworks(null));
    return () => { dead = true; };
  }, [enabled, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { containers, images, volumes, networks, error, reload };
}

export interface ComposeInfo { services: string[]; project: string; source: 'docker' | 'file'; error?: string }
/** The services of a compose file (empty until the file is chosen). */
export function useComposeServices(file: string) {
  const [info, setInfo] = useState<ComposeInfo | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setErr(''); if (!/^\/.+\.ya?ml$/i.test(file)) { setInfo(null); return; }
    let dead = false; setLoading(true);
    const id = setTimeout(() => api.get<ComposeInfo>(`/docker/compose-services?file=${encodeURIComponent(file)}`).then((r) => !dead && setInfo(r)).catch((e) => { if (!dead) { setInfo(null); setErr(e instanceof Error ? e.message : ''); } }).finally(() => !dead && setLoading(false)), 300);
    return () => { dead = true; clearTimeout(id); };
  }, [file]);
  return { info, err, loading };
}
