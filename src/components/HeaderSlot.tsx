import { createContext } from 'react';

// the part of the app header a page can fill with its own controls (via a portal)
export const HeaderSlotContext = createContext<HTMLElement | null>(null);
