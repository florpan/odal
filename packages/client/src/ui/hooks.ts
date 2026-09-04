import { useStore } from 'zustand';
import { appStore } from '../app/store';
import type { AppState } from '../app/store';

/** Subscribe a component to a slice of the app store. Select the smallest slice you need. */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}
