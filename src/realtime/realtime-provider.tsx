import { useQueryClient } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getAuthToken } from '@/api/auth-token';
import { useWorkspaceStore } from '@/stores/use-workspace-store';

import { invalidateWorkspaceQueries, useRealtimeAppState } from './app-state';
import { clearAllTypingTimers } from './typing-timers';
import { resetConnectionStore, useConnectionStore } from './use-connection-store';
import { clearPendingConversationInvalidates, useRealtimeHandlers } from './use-realtime-handlers';
import { WesalSocket } from './wesal-socket';

/**
 * Connects to the Wesal One realtime gateway for one workspace (see wesal-socket.ts for the wire
 * protocol). Replaces the upstream PartyKit connection, which the Wesal One backend does not run.
 */
function ConnectedRealtimeProvider({
  children,
  workspaceId,
}: PropsWithChildren<{ workspaceId: string }>) {
  const queryClient = useQueryClient();
  const handleEvent = useRealtimeHandlers(queryClient, workspaceId);
  const setStatus = useConnectionStore((state) => state.setStatus);
  const markOpened = useConnectionStore((state) => state.markOpened);

  // Reset during the first render, before the socket below can fire `onOpen` (see git history
  // for why an effect-based reset races the first open).
  useState(() => {
    resetConnectionStore();
    return null;
  });

  const socketRef = useRef<WesalSocket | null>(null);

  // One socket per mount; created inside the effect so a dev double-mount gets a fresh instance.
  useEffect(() => {
    const socket = new WesalSocket({
      workspaceId,
      getBearerToken: getAuthToken,
      onEvents: (events) => {
        for (const event of events) handleEvent(event);
      },
      onOpen: (isReconnect) => {
        // The gateway replays from `lastSeq` on reconnect; refetching also covers a replay gap.
        if (isReconnect) invalidateWorkspaceQueries(queryClient, workspaceId);
        markOpened();
      },
      onClose: () => setStatus('closed'),
      onResync: () => invalidateWorkspaceQueries(queryClient, workspaceId),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
      clearAllTypingTimers();
      clearPendingConversationInvalidates();
    };
  }, [workspaceId, queryClient, handleEvent, markOpened, setStatus]);

  const handleBackground = useCallback(() => {
    socketRef.current?.suspend();
  }, []);

  const handleForeground = useCallback(() => {
    socketRef.current?.resume();
    invalidateWorkspaceQueries(queryClient, workspaceId);
  }, [queryClient, workspaceId]);

  useRealtimeAppState({ onBackground: handleBackground, onForeground: handleForeground });

  return children;
}

/** Only connects once a workspace is selected — defensive, since the tabs layout already guards
 * on `currentWorkspaceId` before mounting this provider, but a null id here should never attempt
 * a connection rather than crash on an empty room name. */
export function RealtimeProvider({ children }: PropsWithChildren) {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);

  if (!workspaceId) {
    return children;
  }

  return (
    // `key={workspaceId}` forces a full remount on workspace switch, tearing down the old
    // socket connection rather than reusing the
    // component instance with a new `room` prop — cleaner than relying on the socket library to
    // detect and rejoin a different room on its own.
    <ConnectedRealtimeProvider key={workspaceId} workspaceId={workspaceId}>
      {children}
    </ConnectedRealtimeProvider>
  );
}
