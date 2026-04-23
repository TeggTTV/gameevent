import {
  Room, RoomStatus, Team, Listing, SaleRecord,
  LeaderboardEntry, SSEEvent, Player,
} from './types';
import fs from 'fs';
import path from 'path';
import { generateStoreListings } from './items';
import {
  createScammedScenario,
  createViralMomentScenario,
  createShippingDelayScenario,
  createUndercutScenario,
  resolveScenario,
  getDefaultOutcome,
  ScenarioOutcome,
} from './scenarios';

// ===== Team Colors =====
const TEAM_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  '#06b6d4', '#6366f1',
];

// ===== In-Memory Room Store & Next.js HMR Persistence =====
type EventSubscriber = (event: SSEEvent) => void;

const globalForGameState = globalThis as unknown as {
  rooms: Map<string, Room>;
  roomSubscribers: Map<string, Map<string, EventSubscriber>>;
  roomTimers: Map<string, NodeJS.Timeout>;
  roomItemSpawners: Map<string, NodeJS.Timeout>;
  roomScenarioTimers: Map<string, NodeJS.Timeout>;
  roomAutoBuyerTimers: Map<string, NodeJS.Timeout>;
  roomActivityTimers: Map<string, NodeJS.Timeout>;
  roomEventCounters: Map<string, number>;
  roomEventHistory: Map<string, SSEEvent[]>;
  roomPersistTimer?: NodeJS.Timeout;
};

const rooms = globalForGameState.rooms || new Map<string, Room>();
if (process.env.NODE_ENV !== 'production') globalForGameState.rooms = rooms;

// Subscribers for SSE events per room
const roomSubscribers = globalForGameState.roomSubscribers || new Map<string, Map<string, EventSubscriber>>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomSubscribers = roomSubscribers;

const roomEventCounters = globalForGameState.roomEventCounters || new Map<string, number>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomEventCounters = roomEventCounters;

const roomEventHistory = globalForGameState.roomEventHistory || new Map<string, SSEEvent[]>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomEventHistory = roomEventHistory;

const DATA_DIR = path.join(process.cwd(), '.data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'rooms.json');
const SNAPSHOT_TMP_FILE = path.join(DATA_DIR, 'rooms.tmp.json');
const MAX_EVENT_HISTORY = 300;

function assertSupportedDeploymentMode() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return;
  if (process.env.BUSYTHRIFT_SINGLE_INSTANCE === 'true') return;
  throw new Error(
    'BusyThrift game state uses in-memory storage and is unsafe for multi-instance production. ' +
    'Set BUSYTHRIFT_SINGLE_INSTANCE=true only when deploying a single Node process.'
  );
}

function loadPersistedRooms() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { rooms?: Room[] };
    if (!parsed.rooms || !Array.isArray(parsed.rooms)) return;

    for (const room of parsed.rooms) {
      const normalizedCode = room.code.toUpperCase();
      room.code = normalizedCode;
      rooms.set(normalizedCode, room);
      if (!roomSubscribers.has(normalizedCode)) roomSubscribers.set(normalizedCode, new Map());
      if (!roomEventCounters.has(normalizedCode)) roomEventCounters.set(normalizedCode, 0);
      if (!roomEventHistory.has(normalizedCode)) roomEventHistory.set(normalizedCode, []);
    }
  } catch {
    // Ignore snapshot load failures and continue with empty state.
  }
}

function persistRoomsNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = JSON.stringify({ rooms: Array.from(rooms.values()) });
    fs.writeFileSync(SNAPSHOT_TMP_FILE, payload, 'utf8');
    fs.renameSync(SNAPSHOT_TMP_FILE, SNAPSHOT_FILE);
  } catch {
    // Ignore persistence failures for event-day resilience.
  }
}

function schedulePersist() {
  if (globalForGameState.roomPersistTimer) return;
  globalForGameState.roomPersistTimer = setTimeout(() => {
    globalForGameState.roomPersistTimer = undefined;
    persistRoomsNow();
  }, 400);
}

assertSupportedDeploymentMode();
loadPersistedRooms();

// ===== Room Management =====

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

export function createRoom(startingBudget: number, timerDuration: number, maxTeams: number): Room {
  const code = generateRoomCode();
  const facilitatorId = `facilitator_${Date.now()}`;

  const room: Room = {
    code,
    status: RoomStatus.LOBBY,
    config: { startingBudget, timerDuration, maxTeams },
    facilitatorId,
    teams: [],
    marketplace: [],
  };

  rooms.set(code, room);
  roomSubscribers.set(code, new Map());
  roomEventCounters.set(code, roomEventCounters.get(code) ?? 0);
  roomEventHistory.set(code, roomEventHistory.get(code) ?? []);
  schedulePersist();
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function joinRoom(code: string, teamName: string, playerName: string): { team: Team; room: Room; player: Player } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.status !== RoomStatus.LOBBY) return { error: 'Game has already started' };

  const player: Player = {
    id: `player_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: playerName,
  };

  let team = room.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());

  if (team) {
    team.players.push(player);
  } else {
    if (room.teams.length >= room.config.maxTeams) return { error: 'Room is full' };
    team = {
      id: `team_${Date.now()}_${room.teams.length}`,
      name: teamName,
      color: TEAM_COLORS[room.teams.length % TEAM_COLORS.length],
      budget: room.config.startingBudget,
      inventory: [],
      activeListings: [],
      salesHistory: [],
      scenarios: [],
      scenarioSkipsRemaining: 1,
      totalSpent: 0,
      totalRevenue: 0,
      players: [player],
    };
    room.teams.push(team);
  }

  // Notify all team-joined
  broadcastToRoom(code, {
    type: 'team-joined',
    data: { team: sanitizeTeam(team), teams: room.teams.map(sanitizeTeam) },
    timestamp: Date.now(),
  });

  schedulePersist();

  return { team, room, player };
}

// ===== Game Start =====

const roomTimers = globalForGameState.roomTimers || new Map<string, NodeJS.Timeout>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomTimers = roomTimers;

const roomItemSpawners = globalForGameState.roomItemSpawners || new Map<string, NodeJS.Timeout>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomItemSpawners = roomItemSpawners;

const roomScenarioTimers = globalForGameState.roomScenarioTimers || new Map<string, NodeJS.Timeout>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomScenarioTimers = roomScenarioTimers;

const roomAutoBuyerTimers = globalForGameState.roomAutoBuyerTimers || new Map<string, NodeJS.Timeout>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomAutoBuyerTimers = roomAutoBuyerTimers;

function startRuntimeTimers(room: Room, code: string) {
  const roomCode = code.toUpperCase();

  const existingSpawner = roomItemSpawners.get(roomCode);
  if (existingSpawner) clearInterval(existingSpawner);
  const existingScenarioTimer = roomScenarioTimers.get(roomCode);
  if (existingScenarioTimer) clearInterval(existingScenarioTimer);
  const existingAutoBuyer = roomAutoBuyerTimers.get(roomCode);
  if (existingAutoBuyer) clearInterval(existingAutoBuyer);
  const existingEndTimer = roomTimers.get(roomCode);
  if (existingEndTimer) clearTimeout(existingEndTimer);

  // Start item spawner (every 5 seconds, chance to add 1-3 items)
  const spawner = setInterval(() => {
    if (room.status !== RoomStatus.ACTIVE) {
      clearInterval(spawner);
      return;
    }
    if (Math.random() < 0.7) {
      const count = 1 + Math.floor(Math.random() * 3);
      const newItems = generateStoreListings(count);
      room.marketplace.push(...newItems);

      const storeListings = room.marketplace.filter(l => l.sellerId === '__store__');
      if (storeListings.length > 30) {
        const removeCount = storeListings.length - 30;
        const toRemove = new Set(storeListings.slice(0, removeCount).map(l => l.id));
        room.marketplace = room.marketplace.filter(l => !toRemove.has(l.id));
      }
    }

    broadcastToRoom(roomCode, {
      type: 'marketplace-update',
      data: { marketplace: room.marketplace },
      timestamp: Date.now(),
    });
  }, 5000);
  roomItemSpawners.set(roomCode, spawner);

  const scenarioTimer = setInterval(() => {
    if (room.status !== RoomStatus.ACTIVE) {
      clearInterval(scenarioTimer);
      return;
    }
    triggerRandomScenarios(room);
    checkExpiredScenarios(room);
  }, 30_000);
  roomScenarioTimers.set(roomCode, scenarioTimer);

  const autoBuyer = setInterval(() => {
    if (room.status !== RoomStatus.ACTIVE) {
      clearInterval(autoBuyer);
      return;
    }
    processAutoBuyer(room, roomCode);
  }, 8000 + Math.random() * 7000);
  roomAutoBuyerTimers.set(roomCode, autoBuyer);

  startActivityLogGenerator(room, roomCode);

  const remainingMs = Math.max(0, (room.endsAt ?? Date.now()) - Date.now());
  const endTimer = setTimeout(() => {
    endGame(room, roomCode);
  }, remainingMs);
  roomTimers.set(roomCode, endTimer);
}

function resumeActiveRoomsFromSnapshot() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const roomCode = room.code.toUpperCase();
    room.code = roomCode;
    if (!roomSubscribers.has(roomCode)) roomSubscribers.set(roomCode, new Map());
    if (!roomEventCounters.has(roomCode)) roomEventCounters.set(roomCode, 0);
    if (!roomEventHistory.has(roomCode)) roomEventHistory.set(roomCode, []);

    if (room.status !== RoomStatus.ACTIVE) continue;
    if (!room.endsAt || room.endsAt <= now) {
      endGame(room, roomCode);
      continue;
    }

    startRuntimeTimers(room, roomCode);
  }
}

export function startGame(code: string, facilitatorId: string): { room: Room } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.facilitatorId !== facilitatorId) return { error: 'Only the facilitator can start the game' };
  if (room.status !== RoomStatus.LOBBY) return { error: 'Game already started' };
  if (room.teams.length < 1) return { error: 'Need at least 1 team to start' };

  room.status = RoomStatus.ACTIVE;
  room.startedAt = Date.now();
  room.endsAt = Date.now() + room.config.timerDuration * 1000;

  // Generate initial marketplace items (8-12 items)
  const initialCount = 8 + Math.floor(Math.random() * 5);
  room.marketplace = generateStoreListings(initialCount);

  // Broadcast game started
  broadcastToRoom(code, {
    type: 'game-started',
    data: {
      endsAt: room.endsAt,
      marketplace: room.marketplace,
      leaderboard: getLeaderboard(room),
    },
    timestamp: Date.now(),
  });

  startRuntimeTimers(room, code);
  schedulePersist();

  return { room };
}

// ===== Marketplace Actions =====

export function purchaseItem(
  code: string,
  teamId: string,
  listingId: string,
  offerPrice?: number
): { sale?: SaleRecord; team: Team; error?: string } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.status !== RoomStatus.ACTIVE) return { error: 'Game is not active' };

  const team = room.teams.find(t => t.id === teamId);
  if (!team) return { error: 'Team not found' };

  const listingIndex = room.marketplace.findIndex(l => l.id === listingId);
  if (listingIndex === -1) return { error: 'Item no longer available' };

  const listing = room.marketplace[listingIndex];

  // Can't buy your own listing
  if (listing.sellerId === teamId) return { error: "You can't buy your own listing" };

  // Check if locked
  if (listing.locked && listing.lockedUntil && listing.lockedUntil > Date.now()) {
    return { error: 'This item is temporarily unavailable' };
  }

  // Check if team previously rejected
  if (listing.rejectedBidders?.includes(teamId)) {
    return { error: 'Your team has already been rejected by this seller' };
  }

  const finalPrice = typeof offerPrice === 'number' ? offerPrice : listing.askingPrice;

  // Check budget
  if (team.budget < finalPrice) return { error: 'Not enough budget' };

  // Handle bargaining RNG
  if (typeof offerPrice === 'number' && offerPrice < listing.askingPrice) {
    const ratio = offerPrice / listing.askingPrice;
    let chance = 0;
    if (ratio >= 1.0) chance = 100;
    else if (ratio <= 0.3) chance = 0;
    else chance = Math.round(((ratio - 0.3) / 0.7) * 100);

    const roll = Math.random() * 100;
    if (roll > chance) {
      if (!listing.rejectedBidders) listing.rejectedBidders = [];
      if (!listing.rejectedBidders.includes(teamId)) {
        listing.rejectedBidders.push(teamId);
      }
      return { error: `Offer of $${offerPrice} was rejected by the seller.` };
    }
  }

  // Execute purchase
  team.budget -= finalPrice;
  team.totalSpent += finalPrice;
  // Stamp the purchase price onto the item so the dashboard can show cost basis
  const purchasedItem = { ...listing.item, purchasePrice: finalPrice };
  team.inventory.push(purchasedItem);

  // Remove from marketplace
  room.marketplace.splice(listingIndex, 1);

  // If seller is another team, credit them
  let sale: SaleRecord | undefined;
  if (listing.sellerId !== '__store__') {
    const seller = room.teams.find(t => t.id === listing.sellerId);
    if (seller) {
      seller.budget += finalPrice;
      seller.totalRevenue += finalPrice;
      // Remove from seller's activeListings
      seller.activeListings = seller.activeListings.filter(l => l.id !== listingId);

      // Use actual cost basis when known so profit analytics stay accurate.
      const originalCost = listing.item.purchasePrice ?? listing.item.marketPrice;
      sale = {
        id: `sale_${Date.now()}`,
        item: listing.item,
        soldPrice: finalPrice,
        buyerId: teamId,
        buyerName: team.name,
        sellerId: listing.sellerId,
        sellerName: seller.name,
        profit: finalPrice - originalCost,
        timestamp: Date.now(),
      };
      seller.salesHistory.push(sale);

      // Notify seller
      emitToTeam(code, listing.sellerId, {
        type: 'sale-completed',
        data: { sale, team: sanitizeTeam(seller) },
        timestamp: Date.now(),
      });
    }
  }

  // Broadcast updated marketplace and leaderboard
  broadcastToRoom(code, {
    type: 'item-purchased',
    data: {
      marketplace: room.marketplace,
      leaderboard: getLeaderboard(room),
      buyerTeamId: teamId,
    },
    timestamp: Date.now(),
  });

  // Maybe trigger scam scenario (10% chance on higher-rarity purchases)
  if (listing.sellerId === '__store__' && Math.random() < 0.10) {
    const scenario = createScammedScenario(team, listing.item.id);
    if (scenario) {
      team.scenarios.push(scenario);
      emitToTeam(code, teamId, {
        type: 'scenario-event',
        data: { scenario },
        timestamp: Date.now(),
      });
    }
  }

  return { sale, team };
}

export function listItem(
  code: string,
  teamId: string,
  itemId: string,
  askingPrice: number
): { listing: Listing; team: Team } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.status !== RoomStatus.ACTIVE) return { error: 'Game is not active' };

  const team = room.teams.find(t => t.id === teamId);
  if (!team) return { error: 'Team not found' };

  if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
    return { error: 'Price must be a valid number above $0' };
  }

  const itemIndex = team.inventory.findIndex(i => i.id === itemId);
  if (itemIndex === -1) return { error: 'Item not in inventory' };

  const item = team.inventory[itemIndex];
  team.inventory.splice(itemIndex, 1);

  const listing: Listing = {
    id: `listing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    item,
    askingPrice,
    sellerId: teamId,
    sellerName: team.name,
    listedAt: Date.now(),
  };

  team.activeListings.push(listing);
  room.marketplace.push(listing);

  // Check for undercut alerts — notify any team that has a listing in the same category at a higher price
  for (const otherTeam of room.teams) {
    if (otherTeam.id === teamId) continue;
    for (const otherListing of otherTeam.activeListings) {
      if (otherListing.item.category === item.category && otherListing.askingPrice > askingPrice) {
        const undercutScenario = createUndercutScenario(otherTeam, otherListing.id, listing.id);
        if (undercutScenario) {
          otherTeam.scenarios.push(undercutScenario);
          emitToTeam(code, otherTeam.id, {
            type: 'undercut-alert',
            data: {
              scenario: undercutScenario,
              competitorListing: listing,
            },
            timestamp: Date.now(),
          });
        }
        break; // one alert per team per listing
      }
    }
  }

  // Maybe trigger viral moment (15% chance for Rare/Legendary listings)
  if (Math.random() < 0.15) {
    const viralScenario = createViralMomentScenario(team, listing.id);
    if (viralScenario) {
      team.scenarios.push(viralScenario);
      emitToTeam(code, teamId, {
        type: 'scenario-event',
        data: { scenario: viralScenario },
        timestamp: Date.now(),
      });
    }
  }

  // Broadcast marketplace update
  broadcastToRoom(code, {
    type: 'marketplace-update',
    data: { marketplace: room.marketplace },
    timestamp: Date.now(),
  });

  return { listing, team };
}

// ===== Unlist Item =====

export function unlistItem(
  code: string,
  teamId: string,
  listingId: string
): { team: Team } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.status !== RoomStatus.ACTIVE) return { error: 'Game is not active' };

  const team = room.teams.find(t => t.id === teamId);
  if (!team) return { error: 'Team not found' };

  const listingIndex = team.activeListings.findIndex(l => l.id === listingId);
  if (listingIndex === -1) return { error: 'Listing not found' };

  const listing = team.activeListings[listingIndex];

  // Remove from team's active listings
  team.activeListings.splice(listingIndex, 1);

  // Remove from room marketplace
  room.marketplace = room.marketplace.filter(l => l.id !== listingId);

  // Return item to inventory (keep the purchasePrice intact)
  team.inventory.push(listing.item);

  // Broadcast marketplace update
  broadcastToRoom(code, {
    type: 'marketplace-update',
    data: { marketplace: room.marketplace },
    timestamp: Date.now(),
  });

  return { team };
}

// ===== Scenario Response =====

export function respondToScenario(
  code: string,
  teamId: string,
  playerId: string,
  scenarioId: string,
  optionIndex: number
): { outcome?: ScenarioOutcome; team: Team; status: string } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };

  const team = room.teams.find(t => t.id === teamId);
  if (!team) return { error: 'Team not found' };

  const player = team.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const scenario = team.scenarios.find(s => s.id === scenarioId);
  if (!scenario) return { error: 'Scenario not found' };
  if (scenario.resolved) return { error: 'Scenario already resolved' };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= scenario.options.length) {
    return { error: 'Invalid scenario option' };
  }

  // Record vote
  scenario.votes[playerId] = optionIndex;

  // Check unanimous
  const allVoters = Object.keys(scenario.votes);
  const isEveryone = allVoters.length === team.players.length;
  const isUnanimous = allVoters.every(pid => scenario.votes[pid] === optionIndex);

  if (isEveryone && isUnanimous) {
    let competitorListing: Listing | undefined;
    if (scenario.competitorListingId) {
      competitorListing = room.marketplace.find(l => l.id === scenario.competitorListingId);
    }

    const outcome = resolveScenario(scenario, optionIndex, team, competitorListing);
    scenario.resolved = true;
    scenario.chosenOption = optionIndex;
    scenario.outcomeText = outcome.outcomeText;

    applyOutcome(outcome, team, room, code);
    
    // Broadcast outcome
    emitToTeam(code, team.id, {
      type: 'scenario-event',
      data: { scenario },
      timestamp: Date.now(),
    });

    return { outcome, team, status: 'resolved' };
  } else {
    // Return pending status, broadcast the vote update
    emitToTeam(code, team.id, {
      type: 'scenario-event',
      data: { scenario },
      timestamp: Date.now(),
    });
    return { team, status: 'pending_votes' };
  }
}

export function skipScenario(
  code: string,
  teamId: string,
  playerId: string,
  scenarioId: string
): { outcome?: ScenarioOutcome; team: Team; status: string } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };

  const team = room.teams.find(t => t.id === teamId);
  if (!team) return { error: 'Team not found' };

  const player = team.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  const scenario = team.scenarios.find(s => s.id === scenarioId);
  if (!scenario) return { error: 'Scenario not found' };
  if (scenario.resolved) return { error: 'Scenario already resolved' };
  if (team.scenarioSkipsRemaining <= 0) return { error: 'No scenario skips remaining' };

  const defaultOption = getDefaultOutcome();

  let competitorListing: Listing | undefined;
  if (scenario.competitorListingId) {
    competitorListing = room.marketplace.find(l => l.id === scenario.competitorListingId);
  }

  const outcome = resolveScenario(scenario, defaultOption, team, competitorListing);
  scenario.resolved = true;
  scenario.chosenOption = defaultOption;
  scenario.outcomeText = `⏭️ Scenario skipped. ${outcome.outcomeText}`;

  team.scenarioSkipsRemaining -= 1;
  applyOutcome(outcome, team, room, code);

  emitToTeam(code, team.id, {
    type: 'scenario-event',
    data: { scenario, skipped: true },
    timestamp: Date.now(),
  });

  return { outcome, team, status: 'skipped' };
}

function applyOutcome(outcome: ScenarioOutcome, team: Team, room: Room, code: string) {
  if (outcome.budgetChange) {
    team.budget += outcome.budgetChange;
  }

  if (outcome.modifyItem) {
    const item = team.inventory.find(i => i.id === outcome.modifyItem!.itemId);
    if (item && outcome.modifyItem.newMarketPrice !== undefined) {
      item.marketPrice = outcome.modifyItem.newMarketPrice;
    }
  }

  if (outcome.modifyListing) {
    const mod = outcome.modifyListing;
    const listing = team.activeListings.find(l => l.id === mod.listingId);
    if (listing) {
      if (mod.newAskingPrice !== undefined) {
        listing.askingPrice = mod.newAskingPrice;
        // Update in marketplace too
        const mktListing = room.marketplace.find(l => l.id === mod.listingId);
        if (mktListing) mktListing.askingPrice = mod.newAskingPrice;
      }
      if (mod.lock) {
        listing.locked = true;
        listing.lockedUntil = Date.now() + (mod.lockDurationMs || 120_000);
        const mktListing = room.marketplace.find(l => l.id === mod.listingId);
        if (mktListing) {
          mktListing.locked = true;
          mktListing.lockedUntil = listing.lockedUntil;
        }
      }
      if (mod.pullListing) {
        // Move item back to inventory
        team.inventory.push(listing.item);
        team.activeListings = team.activeListings.filter(l => l.id !== mod.listingId);
        room.marketplace = room.marketplace.filter(l => l.id !== mod.listingId);
      }
      if (mod.instantSell && mod.instantSellPrice !== undefined) {
        // Instant sale
        const sellPrice = mod.instantSellPrice;
        team.budget += sellPrice;
        team.totalRevenue += sellPrice;
        team.activeListings = team.activeListings.filter(l => l.id !== mod.listingId);
        room.marketplace = room.marketplace.filter(l => l.id !== mod.listingId);

        const sale: SaleRecord = {
          id: `sale_${Date.now()}`,
          item: listing.item,
          soldPrice: sellPrice,
          buyerId: '__auto__',
          buyerName: 'Customer',
          sellerId: team.id,
          sellerName: team.name,
          profit: sellPrice - listing.item.marketPrice,
          timestamp: Date.now(),
        };
        team.salesHistory.push(sale);
      }
    }
  }

  if (outcome.guaranteedSale) {
    const gs = outcome.guaranteedSale;
    setTimeout(() => {
      if (room.status !== RoomStatus.ACTIVE) return;
      const listing = team.activeListings.find(l => l.id === gs.listingId);
      if (!listing) return;

      team.budget += listing.askingPrice;
      team.totalRevenue += listing.askingPrice;
      team.activeListings = team.activeListings.filter(l => l.id !== gs.listingId);
      room.marketplace = room.marketplace.filter(l => l.id !== gs.listingId);

      const sale: SaleRecord = {
        id: `sale_${Date.now()}`,
        item: listing.item,
        soldPrice: listing.askingPrice,
        buyerId: '__auto__',
        buyerName: 'Customer',
        sellerId: team.id,
        sellerName: team.name,
        profit: listing.askingPrice - listing.item.marketPrice,
        timestamp: Date.now(),
      };
      team.salesHistory.push(sale);

      emitToTeam(code, team.id, {
        type: 'sale-completed',
        data: { sale, team: sanitizeTeam(team) },
        timestamp: Date.now(),
      });

      broadcastToRoom(code, {
        type: 'leaderboard-update',
        data: { leaderboard: getLeaderboard(room) },
        timestamp: Date.now(),
      });
    }, gs.delayMs);
  }

  // Broadcast updates
  broadcastToRoom(code, {
    type: 'marketplace-update',
    data: { marketplace: room.marketplace },
    timestamp: Date.now(),
  });
  broadcastToRoom(code, {
    type: 'leaderboard-update',
    data: { leaderboard: getLeaderboard(room) },
    timestamp: Date.now(),
  });
}

// ===== Auto-Buyer System =====

const CUSTOMER_NAMES = [
  'Malik', 'Jasmine', 'Devon', 'Priya', 'Carlos',
  'Aisha', 'Tyler', 'Luna', 'Jordan', 'Nina',
  'Sophie', 'Marcus', 'Zara', 'Eli', 'Mia',
];

function pickCustomerName() {
  return CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
}

function processAutoBuyer(room: Room, code: string) {
  // Find player-listed items on the marketplace
  const playerListings = room.marketplace.filter(
    l => l.sellerId !== '__store__' && !l.locked
  );
  if (playerListings.length === 0) return;

  // Pick a random listing, chance to buy based on price fairness
  const listing = playerListings[Math.floor(Math.random() * playerListings.length)];
  const fairPrice = listing.item.marketPrice;
  const ratio = listing.askingPrice / fairPrice;

  // More likely to buy if price is near or below fair value
  let buyChance = 0;
  if (ratio <= 0.8) buyChance = 0.9;       // Underpriced — almost certain buy
  else if (ratio <= 1.0) buyChance = 0.6;   // Fair price
  else if (ratio <= 1.3) buyChance = 0.3;   // Slightly overpriced
  else if (ratio <= 1.6) buyChance = 0.1;   // Overpriced
  else buyChance = 0.02;                     // Very overpriced — unlikely

  const customerName = pickCustomerName();

  if (Math.random() > buyChance) {
    // Did NOT buy — generate an activity log event for the seller
    generateBrowseLog(room, code, listing, ratio, customerName);
    return;
  }

  // Execute auto-buy
  const seller = room.teams.find(t => t.id === listing.sellerId);
  if (!seller) return;

  // Remove from marketplace and seller's listings
  room.marketplace = room.marketplace.filter(l => l.id !== listing.id);
  seller.activeListings = seller.activeListings.filter(l => l.id !== listing.id);

  // Credit seller
  seller.budget += listing.askingPrice;
  seller.totalRevenue += listing.askingPrice;

  const sale: SaleRecord = {
    id: `sale_${Date.now()}`,
    item: listing.item,
    soldPrice: listing.askingPrice,
    buyerId: '__auto__',
    buyerName: customerName,
    sellerId: listing.sellerId,
    sellerName: seller.name,
    profit: listing.askingPrice - (listing.item.purchasePrice ?? listing.item.marketPrice),
    timestamp: Date.now(),
  };
  seller.salesHistory.push(sale);

  // Notify seller
  emitToTeam(code, seller.id, {
    type: 'sale-completed',
    data: { sale, team: sanitizeTeam(seller) },
    timestamp: Date.now(),
  });

  // Activity log: item sold
  emitToTeam(code, seller.id, {
    type: 'activity-log',
    data: {
      message: `💰 ${customerName} bought your "${listing.item.name}" for $${listing.askingPrice}!`,
      variant: 'success',
    },
    timestamp: Date.now(),
  });

  // Broadcast
  broadcastToRoom(code, {
    type: 'marketplace-update',
    data: { marketplace: room.marketplace },
    timestamp: Date.now(),
  });
  broadcastToRoom(code, {
    type: 'leaderboard-update',
    data: { leaderboard: getLeaderboard(room) },
    timestamp: Date.now(),
  });
}

function generateBrowseLog(room: Room, code: string, listing: Listing, ratio: number, customerName: string) {
  // Generate contextual browsing feedback
  let message: string;
  let variant: 'info' | 'warning' | 'danger';

  if (ratio > 2.0) {
    // Way overpriced
    const msgs = [
      `😬 ${customerName} glanced at "${listing.item.name}" and laughed at the $${listing.askingPrice} price tag.`,
      `🚶 ${customerName} saw "${listing.item.name}" listed for $${listing.askingPrice}... walked away immediately.`,
      `💸 ${customerName} said "$$${listing.askingPrice} for that?!" and left. You may want to lower the price significantly.`,
    ];
    message = msgs[Math.floor(Math.random() * msgs.length)];
    variant = 'danger';
  } else if (ratio > 1.5) {
    // Overpriced
    const msgs = [
      `🤔 ${customerName} picked up "${listing.item.name}", checked the $${listing.askingPrice} tag, and put it back.`,
      `👀 ${customerName} seemed interested in "${listing.item.name}" but hesitated at $${listing.askingPrice}. Try lowering the price.`,
      `🏷️ ${customerName} browsed "${listing.item.name}" but thought $${listing.askingPrice} was too steep.`,
    ];
    message = msgs[Math.floor(Math.random() * msgs.length)];
    variant = 'warning';
  } else if (ratio > 1.2) {
    // Slightly overpriced
    const msgs = [
      `🤷 ${customerName} considered "${listing.item.name}" at $${listing.askingPrice} but wasn't quite convinced. Close to selling!`,
      `👋 ${customerName} almost bought "${listing.item.name}" but decided to shop around first.`,
      `📋 ${customerName} added "${listing.item.name}" to their wishlist. A small price drop might seal the deal.`,
    ];
    message = msgs[Math.floor(Math.random() * msgs.length)];
    variant = 'info';
  } else {
    // Fair/underpriced but still didn't buy (unlucky roll)
    const msgs = [
      `🛍️ ${customerName} liked "${listing.item.name}" but wasn't looking for ${listing.item.category} today.`,
      `⏰ ${customerName} was interested in "${listing.item.name}" but ran out of time. They might come back!`,
      `🤝 ${customerName} nearly bought "${listing.item.name}" — your pricing looks good, just need the right buyer.`,
    ];
    message = msgs[Math.floor(Math.random() * msgs.length)];
    variant = 'info';
  }

  emitToTeam(code, listing.sellerId, {
    type: 'activity-log',
    data: { message, variant, itemName: listing.item.name, listingId: listing.id },
    timestamp: Date.now(),
  });
}

// Also generate random "store browsing" activity for all teams
const roomActivityTimers = globalForGameState.roomActivityTimers || new Map<string, NodeJS.Timeout>();
if (process.env.NODE_ENV !== 'production') globalForGameState.roomActivityTimers = roomActivityTimers;

function startActivityLogGenerator(room: Room, code: string) {
  const timer = setInterval(() => {
    if (room.status !== RoomStatus.ACTIVE) {
      clearInterval(timer);
      return;
    }
    // Generate ambient store activity for teams
    for (const team of room.teams) {
      if (Math.random() > 0.3) continue; // 30% chance per team per tick

      const ambientMessages = [
        '🏪 A new shipment of vintage items just arrived at the thrift store!',
        '📢 Word on the street: customers are looking for Rare items today.',
        '🔥 The marketplace is heating up — items are moving fast!',
        '💡 Tip: Items priced near their market value sell quickly.',
        '🏷️ Overheard a customer say: "I love a good deal on accessories."',
        '📦 A popular thrift influencer just posted about this store!',
        '🎯 Pro tip: Check the marketplace for undervalued items to flip.',
        '🛒 Foot traffic is picking up — good time to list your items!',
      ];

      emitToTeam(code, team.id, {
        type: 'activity-log',
        data: {
          message: ambientMessages[Math.floor(Math.random() * ambientMessages.length)],
          variant: 'info' as const,
        },
        timestamp: Date.now(),
      });
    }
  }, 12000);

  roomActivityTimers.set(code, timer);
}

export { roomActivityTimers };

resumeActiveRoomsFromSnapshot();

// ===== Scenario Triggers =====

function triggerRandomScenarios(room: Room) {
  for (const team of room.teams) {
    // Check if team already has an unresolved scenario
    if (team.scenarios.some(s => !s.resolved)) continue;

    // ~30% chance per check interval to get a scenario
    if (Math.random() > 0.3) continue;

    // Pick scenario type randomly
    const roll = Math.random();
    if (roll < 0.4 && team.activeListings.length > 0) {
      // Shipping delay on a random listing
      const listing = team.activeListings[Math.floor(Math.random() * team.activeListings.length)];
      if (!listing.locked) {
        const scenario = createShippingDelayScenario(team, listing.id);
        if (scenario) {
          team.scenarios.push(scenario);
          emitToTeam(room.code, team.id, {
            type: 'scenario-event',
            data: { scenario },
            timestamp: Date.now(),
          });
        }
      }
    } else if (roll < 0.7 && team.activeListings.length > 0) {
      // Viral moment on a listing
      const listing = team.activeListings[Math.floor(Math.random() * team.activeListings.length)];
      const scenario = createViralMomentScenario(team, listing.id);
      if (scenario) {
        team.scenarios.push(scenario);
        emitToTeam(room.code, team.id, {
          type: 'scenario-event',
          data: { scenario },
          timestamp: Date.now(),
        });
      }
    } else if (team.inventory.length > 0) {
      // Scam scenario on a random inventory item
      const item = team.inventory[Math.floor(Math.random() * team.inventory.length)];
      const scenario = createScammedScenario(team, item.id);
      if (scenario) {
        team.scenarios.push(scenario);
        emitToTeam(room.code, team.id, {
          type: 'scenario-event',
          data: { scenario },
          timestamp: Date.now(),
        });
      }
    }
  }
}

function checkExpiredScenarios(room: Room) {
  const now = Date.now();
  for (const team of room.teams) {
    for (const scenario of team.scenarios) {
      if (!scenario.resolved && now > scenario.expiresAt) {
        // Auto-resolve with default option
        const defaultOption = getDefaultOutcome();

        let competitorListing: Listing | undefined;
        if (scenario.competitorListingId) {
          competitorListing = room.marketplace.find(l => l.id === scenario.competitorListingId);
        }

        const outcome = resolveScenario(scenario, defaultOption, team, competitorListing);
        scenario.resolved = true;
        scenario.chosenOption = defaultOption;
        scenario.outcomeText = `⏰ Time's up! Default: ${outcome.outcomeText}`;

        applyOutcome(outcome, team, room, room.code);

        emitToTeam(room.code, team.id, {
          type: 'scenario-event',
          data: { scenario, autoResolved: true },
          timestamp: Date.now(),
        });
      }
    }
  }
}

// ===== End Game =====

function endGame(room: Room, code: string) {
  room.status = RoomStatus.ENDED;

  // Clear all timers
  const spawner = roomItemSpawners.get(code);
  if (spawner) clearInterval(spawner);
  const scenarioTimer = roomScenarioTimers.get(code);
  if (scenarioTimer) clearInterval(scenarioTimer);
  const autoBuyer = roomAutoBuyerTimers.get(code);
  if (autoBuyer) clearInterval(autoBuyer);
  const endTimer = roomTimers.get(code);
  if (endTimer) clearTimeout(endTimer);
  const activityTimer = roomActivityTimers.get(code);
  if (activityTimer) clearInterval(activityTimer);

  const leaderboard = getLeaderboard(room);

  // Calculate post-game stats
  const postGameStats = room.teams.map(team => {
    const bestSale = team.salesHistory.reduce(
      (best, sale) => (sale.profit > (best?.profit ?? -Infinity) ? sale : best),
      null as SaleRecord | null
    );
    return {
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      netProfit: team.totalRevenue - team.totalSpent,
      itemsBought: team.inventory.length + team.activeListings.length + team.salesHistory.length,
      itemsSold: team.salesHistory.length,
      bestSale: bestSale ? {
        itemName: bestSale.item.name,
        profit: bestSale.profit,
        soldPrice: bestSale.soldPrice,
      } : null,
      scenariosReceived: team.scenarios.length,
      scenariosAnswered: team.scenarios.filter(s => s.resolved && s.chosenOption !== undefined).length,
    };
  });

  broadcastToRoom(code, {
    type: 'game-over',
    data: { leaderboard, postGameStats },
    timestamp: Date.now(),
  });
}

export function endGameByFacilitator(code: string, facilitatorId: string): { room: Room } | { error: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (room.facilitatorId !== facilitatorId) return { error: 'Only the facilitator can end the game' };
  if (room.status !== RoomStatus.ACTIVE) return { error: 'Game is not active' };

  endGame(room, room.code);
  return { room };
}

// ===== Leaderboard =====

export function getLeaderboard(room: Room): LeaderboardEntry[] {
  const entries = room.teams.map(team => ({
    teamId: team.id,
    teamName: team.name,
    teamColor: team.color,
    netProfit: team.totalRevenue - team.totalSpent,
    itemsSold: team.salesHistory.length,
    rank: 0,
  }));

  entries.sort((a, b) => b.netProfit - a.netProfit);
  entries.forEach((entry, i) => (entry.rank = i + 1));

  return entries;
}

// ===== SSE =====

export function subscribeToRoom(code: string, subscriberId: string, callback: EventSubscriber) {
  const subs = roomSubscribers.get(code.toUpperCase());
  if (!subs) return;
  subs.set(subscriberId, callback);
}

export function unsubscribeFromRoom(code: string, subscriberId: string) {
  const subs = roomSubscribers.get(code.toUpperCase());
  if (!subs) return;
  subs.delete(subscriberId);
}

function broadcastToRoom(code: string, event: SSEEvent) {
  const roomCode = code.toUpperCase();
  const nextEventId = (roomEventCounters.get(roomCode) ?? 0) + 1;
  roomEventCounters.set(roomCode, nextEventId);

  const enrichedEvent: SSEEvent = {
    ...event,
    id: nextEventId,
  };

  const history = roomEventHistory.get(roomCode) ?? [];
  history.push(enrichedEvent);
  if (history.length > MAX_EVENT_HISTORY) {
    history.splice(0, history.length - MAX_EVENT_HISTORY);
  }
  roomEventHistory.set(roomCode, history);

  schedulePersist();

  const subs = roomSubscribers.get(roomCode);
  if (!subs) return;
  subs.forEach(cb => cb(enrichedEvent));
}

function emitToTeam(code: string, teamId: string, event: SSEEvent) {
  // For targeted events, we broadcast to all but include teamId in the event
  // Clients filter by their own teamId
  const targeted = { ...event, data: { ...(event.data as Record<string, unknown>), targetTeamId: teamId } };
  broadcastToRoom(code, targeted);
}

// ===== Sanitization (hide sensitive data) =====

function sanitizeTeam(team: Team) {
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    budget: team.budget,
    inventoryCount: team.inventory.length,
    activeListingsCount: team.activeListings.length,
    salesCount: team.salesHistory.length,
    netProfit: team.totalRevenue - team.totalSpent,
  };
}

// ===== Get Team Full Data (for the team itself) =====

export function getTeamData(code: string, teamId: string) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return null;
  const team = room.teams.find(t => t.id === teamId);
  return team ?? null;
}

export function getRoomEventHistorySince(code: string, sinceEventId: number): SSEEvent[] {
  const history = roomEventHistory.get(code.toUpperCase()) ?? [];
  return history.filter((event) => typeof event.id === 'number' && event.id > sinceEventId);
}
