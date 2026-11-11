import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Keeps the last fatal JS error so it can be shown on the next launch. Release builds otherwise
 * close with a bare "keeps stopping" dialog and the cause is lost. Imported first in the root
 * layout so it is installed before any other module runs.
 */
const STORAGE_KEY = 'wesalone.lastCrash';
const MAX_STACK_LINES = 8;

interface ErrorUtilsLike {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

export function formatCrash(error: unknown): string {
  if (error instanceof Error) {
    const stack = (error.stack ?? '').split('\n').slice(0, MAX_STACK_LINES).join('\n');
    return stack.includes(error.message) ? stack : `${error.name}: ${error.message}\n${stack}`;
  }
  return String(error);
}

function install(): void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      AsyncStorage.setItem(STORAGE_KEY, formatCrash(error)).catch(() => undefined);
    }
    previous(error, isFatal);
  });
}

/** Returns the crash saved by the previous run (if any) and forgets it. */
export async function takeLastCrash(): Promise<string | null> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) await AsyncStorage.removeItem(STORAGE_KEY);
    return saved;
  } catch {
    return null;
  }
}

install();
