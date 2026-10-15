import { subscribeWorkspaceEvents } from "../../../../lib/realtime-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let cancelStream = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const pushEvent = (event: { scope: string; timestamp: string; initial?: boolean }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      controller.enqueue(encoder.encode(`event: ready\ndata: {"ok":true}\n\n`));
      const unsubscribe = subscribeWorkspaceEvents(pushEvent);
      const keepAliveId = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);

      const close = (closeController = true) => {
        if (closed) return;
        closed = true;
        clearInterval(keepAliveId);
        clearTimeout(streamTimeoutId);
        unsubscribe();
        request.signal.removeEventListener("abort", onAbort);
        if (closeController) controller.close();
      };
      const onAbort = () => close();
      cancelStream = () => close(false);

      // Auto-close very old streams to avoid stale listeners.
      const streamTimeoutId = setTimeout(() => {
        close();
      }, 10 * 60 * 1000);

      // Dashboards load on mount and can ignore this legacy snapshot trigger.
      pushEvent({ scope: "all", timestamp: new Date().toISOString(), initial: true });

      // Cleanup when consumer aborts.
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
