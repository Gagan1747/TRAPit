import { subscribeWorkspaceEvents } from "../../../../lib/realtime-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pushEvent = (event: { scope: string; timestamp: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      controller.enqueue(encoder.encode(`event: ready\ndata: {"ok":true}\n\n`));
      const unsubscribe = subscribeWorkspaceEvents(pushEvent);
      const keepAliveId = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15000);

      const close = () => {
        clearInterval(keepAliveId);
        unsubscribe();
        controller.close();
      };

      // Auto-close very old streams to avoid stale listeners.
      const streamTimeoutId = setTimeout(() => {
        close();
      }, 10 * 60 * 1000);

      // Send one snapshot trigger to populate views quickly on connect.
      pushEvent({ scope: "all", timestamp: new Date().toISOString() });

      // Cleanup when consumer aborts.
      request.signal.addEventListener("abort", () => {
        clearTimeout(streamTimeoutId);
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
