'use client';
import { createContext, useContext } from 'react';

/** What the Shell opens for the pages inside it: the command palette and the keyboard shortcuts sheet (Home's header buttons). */
export interface ShellCommands { openPalette: () => void; openShortcuts: () => void }

export const ShellCommandsContext = createContext<ShellCommands>({ openPalette: () => undefined, openShortcuts: () => undefined });

export const useShellCommands = (): ShellCommands => useContext(ShellCommandsContext);
