import "server-only";

import { EventEmitter } from "node:events";

type WorkspaceEvent = {
  scope: "all" | "apportion" | "poll" | "test";
  timestamp: string;
};

const emitter = new EventEmitter();

emitter.setMaxListeners(0);

const EVENT_NAME = "workspace-update";

export function publishWorkspaceEvent(scope: WorkspaceEvent["scope"]) {
  emitter.emit(EVENT_NAME, {
    scope,
    timestamp: new Date().toISOString(),
  } satisfies WorkspaceEvent);
}

export function subscribeWorkspaceEvents(listener: (event: WorkspaceEvent) => void) {
  emitter.on(EVENT_NAME, listener);
  return () => emitter.off(EVENT_NAME, listener);
}
