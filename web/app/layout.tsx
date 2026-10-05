import type { Metadata } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Shell } from '@/components/Shell';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--f-display', axes: ['opsz'] });
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--f-body' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--f-mono' });

export const metadata: Metadata = { title: 'hive-am', description: 'Run a colony of coding agents across Claude Code, OpenCode and Kiro.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
