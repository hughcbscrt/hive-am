import { Boxes, CalendarClock, Hexagon, History, House, Library, MessageSquare, Network, Plug, Server, Users, type LucideIcon } from 'lucide-react';
import type { SectionId } from '@/lib/sections';

/** The icon of each screen: the same in the menu, the palette and the Home cards, so one is recognised in the others. */
export const SECTION_ICON: Record<SectionId, LucideIcon> = {
  home: House, chat: MessageSquare, colony: Hexagon, resources: Server, agents: Users, schedules: CalendarClock,
  relations: Network, connections: Plug, types: Boxes, skills: Library, sessions: History,
};
