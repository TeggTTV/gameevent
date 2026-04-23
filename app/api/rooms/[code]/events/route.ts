import { subscribeToRoom, unsubscribeFromRoom, getRoom, getTeamData, getLeaderboard, getRoomEventHistorySince } from '@/lib/gameState';
import { getBearerToken, verifyToken } from '@/lib/auth';
import { SSEEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const url = new URL(request.url);
  const token = getBearerToken(request) ?? url.searchParams.get('token');
  const sinceEventIdRaw = url.searchParams.get('sinceEventId');
  const sinceEventId = sinceEventIdRaw ? Number(sinceEventIdRaw) : 0;

  const claims = token ? verifyToken(token) : null;
  if (!claims || claims.roomCode !== code.toUpperCase()) {
    return Response.json({ error: 'Unauthorized session token' }, { status: 401 });
  }

  const viewerTeamId = claims.role === 'player' ? claims.teamId ?? null : null;
  if (claims.role === 'player' && !viewerTeamId) {
    return Response.json({ error: 'Unauthorized player token' }, { status: 401 });
  }

  const room = getRoom(code);
  if (!room) {
    return Response.json({ error: 'Room not found' }, { status: 404 });
  }

  const subscriberId = `${viewerTeamId || claims.role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      const connectedData: Record<string, unknown> = {
        roomCode: code,
        roomStatus: room.status,
        teams: room.teams.map(t => ({ id: t.id, name: t.name, color: t.color })),
        marketplace: room.marketplace,
        leaderboard: getLeaderboard(room),
        endsAt: room.endsAt,
      };

      // If team specified, include their full data
      if (viewerTeamId) {
        const team = getTeamData(code, viewerTeamId);
        if (team) {
          connectedData.team = team;
        }
      }

      const initEvent = `data: ${JSON.stringify({ type: 'connected', data: connectedData, timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(initEvent));

      // Replay any missed events after the connection handshake.
      if (Number.isFinite(sinceEventId) && sinceEventId > 0) {
        const missed = getRoomEventHistorySince(code, sinceEventId);
        for (const event of missed) {
          const eventData = event.data as Record<string, unknown>;
          if (viewerTeamId && eventData?.targetTeamId && eventData.targetTeamId !== viewerTeamId) {
            continue;
          }
          const replayMsg = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(replayMsg));
        }
      }

      // Subscribe to room events
      const callback = (event: SSEEvent) => {
        try {
          // Filter targeted events for the right team
          const eventData = event.data as Record<string, unknown>;
          if (viewerTeamId && eventData?.targetTeamId && eventData.targetTeamId !== viewerTeamId) {
            return; // Skip events not targeted at this team
          }

          // For team-update events, include full team data
          let enrichedEvent = event;
          if (viewerTeamId && (event.type === 'sale-completed' || event.type === 'scenario-event' || event.type === 'item-purchased')) {
            const team = getTeamData(code, viewerTeamId);
            if (team) {
              enrichedEvent = {
                ...event,
                data: { ...(event.data as Record<string, unknown>), team },
              };
            }
          }

          const sseMsg = `data: ${JSON.stringify(enrichedEvent)}\n\n`;
          controller.enqueue(encoder.encode(sseMsg));
        } catch {
          // Stream closed
        }
      };

      subscribeToRoom(code, subscriberId, callback);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        unsubscribeFromRoom(code, subscriberId);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
