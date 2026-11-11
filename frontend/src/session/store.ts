import { useEffect, useSyncExternalStore } from "react";
import { desktopSession, isDesktop } from "../desktop/bridge";
import { emptySession, reduceSession } from "./model";
import type { FocusSession, SessionAction } from "./model";

interface Transport {
  read: () => Promise<FocusSession>;
  send: (action: SessionAction) => Promise<FocusSession>;
  listen: (callback: (value: FocusSession) => void) => Promise<() => void>;
}
export function createSessionStore(transport?: Transport) {
  let snapshot = { session: emptySession(), ready: !transport, error: "" };
  const listeners = new Set<() => void>();
  let dispose: (() => void) | undefined;
  let generation = 0;
  const publish = () => listeners.forEach((listener) => listener());
  function accept(session: FocusSession) {
    if (session.revision < snapshot.session.revision) return;
    snapshot = { session, ready: true, error: "" };
    publish();
  }
  function fail(error: unknown) {
    snapshot = {
      ...snapshot,
      error: `집중 상태를 동기화하지 못했어요. ${String(error)}`,
    };
    publish();
  }
  async function connect() {
    if (!transport) return;
    dispose?.();
    dispose = undefined;
    const version = ++generation;
    try {
      const unlisten = await transport.listen((value) => {
        if (version === generation) accept(value);
      });
      if (version !== generation) {
        unlisten();
        return;
      }
      dispose = unlisten;
      const session = await transport.read();
      if (version === generation) accept(session);
    } catch (error) {
      if (version === generation) fail(error);
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) void connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          generation++;
          dispose?.();
          dispose = undefined;
        }
      };
    },
    async send(action: SessionAction) {
      if (transport) accept(await transport.send(action));
      else accept(reduceSession(snapshot.session, action));
    },
    async sync() {
      if (!transport) return;
      if (!dispose) {
        await connect();
        return;
      }
      try {
        accept(await transport.read());
      } catch (error) {
        fail(error);
      }
    },
  };
}

export const sessionStore = createSessionStore(
  isDesktop() ? desktopSession : undefined,
);
export function useFocusSession() {
  const state = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
  );
  useEffect(() => {
    const sync = () => void sessionStore.sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  return state;
}
