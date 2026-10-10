'use client';
import { use } from 'react';
import { ObjectWorkspace } from '@/components/objects/ObjectWorkspace';

export default function ObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ObjectWorkspace id={id} />;
}
