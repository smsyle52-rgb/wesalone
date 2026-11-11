import { useEffect } from 'react';

import { useConnectionStore } from './use-connection-store';

/**
 * Wesal One builds do not ship a native network-state module (it crashed some Android devices at
 * launch), so reachability is reported as "reachable" and recovery relies on the socket's own
 * backoff plus the foreground `resume()`. `onRegained` is kept so the provider's wiring stays the
 * same if a reachability source is added back later.
 */
export function useNetworkReachability(_options: { onRegained: () => void }): void {
  const setNetworkReachable = useConnectionStore((state) => state.setNetworkReachable);

  useEffect(() => {
    setNetworkReachable(true);
  }, [setNetworkReachable]);
}
