import type { Metadata } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Shell } from '@/components/Shell';
import { LOCALE_KEY } from '@/lib/i18n/core';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--f-display', axes: ['opsz'] });
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--f-body' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--f-mono' });

export const metadata: Metadata = { title: 'hive-am', description: 'Run a colony of coding agents across Claude Code, OpenCode and Kiro.' };

/**
 * Runs before the first paint: applies the saved (or the system's) theme and language so a dark page never flashes light and `lang` is right from the start.
 * Without a saved theme it also follows the system while the page is open. Keys: 'hive-theme' (Shell) and LOCALE_KEY (lib/i18n/core).
 */
const INIT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('hive-theme');if(t!=='light'&&t!=='dark'){var m=matchMedia('(prefers-color-scheme: dark)');t=m.matches?'dark':'light';m.addEventListener('change',function(e){if(!localStorage.getItem('hive-theme'))d.dataset.theme=e.matches?'dark':'light'})}d.dataset.theme=t;var l=localStorage.getItem(${JSON.stringify(LOCALE_KEY)});if(l!=='en'&&l!=='es')l=(navigator.language||'').toLowerCase().indexOf('es')===0?'es':'en';d.lang=l}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: INIT }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
