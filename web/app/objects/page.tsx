'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useHive } from '@/lib/store';
import { ObjectWorkspace } from '@/components/objects/ObjectWorkspace';

/** /objects: the list, and the first object opened when there is one. */
export default function Objects() {
  const { objects, ready } = useHive();
  const router = useRouter();
  useEffect(() => { if (ready && objects.length) router.replace(`/objects/${objects[0].id}`); }, [ready, objects, router]);
  return <ObjectWorkspace />;
}
