import { createRoom } from '@/lib/gameState';
import { issueFacilitatorToken } from '@/lib/auth';

const MIN_BUDGET = 100;
const MAX_BUDGET = 5000;
const MIN_TIMER_SECONDS = 300;
const MAX_TIMER_SECONDS = 3600;
const MIN_TEAMS = 1;
const MAX_TEAMS = 10;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { startingBudget, timerDuration, maxTeams } = body;

    if (startingBudget === undefined || timerDuration === undefined || maxTeams === undefined) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const parsedBudget = Number(startingBudget);
    const parsedTimer = Number(timerDuration);
    const parsedMaxTeams = Number(maxTeams);

    if (![parsedBudget, parsedTimer, parsedMaxTeams].every(Number.isFinite)) {
      return Response.json({ error: 'All fields must be valid numbers' }, { status: 400 });
    }

    const room = createRoom(
      clamp(Math.round(parsedBudget), MIN_BUDGET, MAX_BUDGET),
      clamp(Math.round(parsedTimer), MIN_TIMER_SECONDS, MAX_TIMER_SECONDS),
      clamp(Math.round(parsedMaxTeams), MIN_TEAMS, MAX_TEAMS)
    );

    return Response.json({
      code: room.code,
      facilitatorId: room.facilitatorId,
      facilitatorToken: issueFacilitatorToken(room.code, room.facilitatorId),
      config: room.config,
    });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
