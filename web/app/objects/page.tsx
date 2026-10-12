'use client';
import { useEffect } from 'react';
import { useHive } from '@/lib/store';
import { ObjectWorkspace } from '@/components/objects/ObjectWorkspace';

/** /objects: the list, and the first object opened when there is one. The address is rewritten in place (no navigation), so the screen is not torn down and rebuilt on the way to /objects/<id>. */
export default function Objects() {
  const { objects, ready } = useHive();
  const first = objects[0]?.id;
  useEffect(() => { if (ready && first) window.history.replaceState(window.history.state, '', `/objects/${first}`); }, [ready, first]);
  return <ObjectWorkspace id={first} />;
}
