'use client';
import { memo, useMemo } from 'react';
import { highlightLine, highlightLines, showWhitespace } from '@/lib/highlight';
import { useGitPrefs } from '@/lib/gitPrefs';

/** Already-highlighted HTML (one line or many), with the "show whitespace" preference applied. The only place that does so. */
export function CodeHtml({ html }: { html: string }) {
  const { whitespace } = useGitPrefs();
  const out = useMemo(() => (whitespace ? showWhitespace(html) : html), [html, whitespace]);
  return <span dangerouslySetInnerHTML={{ __html: out || ' ' }} />;
}

/** Same, without reading preferences: for long lists of rows, where the parent reads them once and passes `ws` down. */
export const CodeCell = memo(function CodeCell({ html, ws }: { html: string; ws: boolean }) {
  const out = useMemo(() => (ws ? showWhitespace(html) : html), [html, ws]);
  return <span dangerouslySetInnerHTML={{ __html: out || ' ' }} />;
});

/** Highlighted multi-line code for a file's language. */
export function Code({ text, path }: { text: string; path: string }) {
  const html = useMemo(() => highlightLines(text, path).join('\n'), [text, path]);
  return <CodeHtml html={html} />;
}

/** One diff line on its own. */
export const CodeLine = memo(function CodeLine({ text, path, ws }: { text: string; path: string; ws: boolean }) {
  const html = useMemo(() => highlightLine(text, path), [text, path]);
  return <CodeCell html={html} ws={ws} />;
});
