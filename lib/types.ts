// ===== Enums =====

export enum RoomStatus {
  LOBBY = 'lobby',
  ACTIVE = 'active',
  ENDED = 'ended',
}

export enum Rarity {
  COMMON = 'Common',
  UNCOMMON = 'Uncommon',
  RARE = 'Rare',
  LEGENDARY = 'Legendary',
}

export enum Condition {
  S = 'S',
  A = 'A',
  B = 'B',
  C = 'C',
}

export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  [Rarity.COMMON]: 1,
  [Rarity.UNCOMMON]: 1.5,
  [Rarity.RARE]: 2.5,
  [Rarity.LEGENDARY]: 5,
};

export const CONDITION_MODIFIER: Record<Condition, number> = {
  [Condition.S]: 1.2,
  [Condition.A]: 1.0,
  [Condition.B]: 0.9,
  [Condition.C]: 0.75,
};

export const CONDITION_LABEL: Record<Condition, string> = {
  [Condition.S]: 'Mint',
  [Condition.A]: 'Great',
  [Condition.B]: 'Good',
  [Condition.C]: 'Fair',
};

export const RARITY_COLOR: Record<Rarity, string> = {
  [Rarity.COMMON]: '#9ca3af',
  [Rarity.UNCOMMON]: '#22d3ee',
  [Rarity.RARE]: '#a78bfa',
  [Rarity.LEGENDARY]: '#f59e0b',
};

// ===== Data Interfaces =====

export interface Item {
  id: string;
  name: string;
  category: string;
  rarity: Rarity;
  condition: Condition;
  basePrice: number;
  marketPrice: number; // basePrice * rarityMult * conditionMod
  purchasePrice?: number; // what the team actually paid for this item
}

export interface Listing {
  id: string;
  item: Item;
  askingPrice: number;
  sellerId: string;      // teamId or '__store__' for auto-generated
  sellerName: string;
  listedAt: number;       // timestamp
  locked?: boolean;       // true if locked by a scenario (shipping delay)
  lockedUntil?: number;
  rejectedBidders?: string[]; // Teams that have failed to bargain
}

export interface SaleRecord {
  id: string;
  item: Item;
  soldPrice: number;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  profit: number; // soldPrice - item.marketPrice (for seller)
  timestamp: number;
}

export interface ScenarioOption {
  label: string;
  description: string;
}

export interface Scenario {
  id: string;
  type: 'scammed' | 'viral' | 'shipping_delay' | 'undercut';
  title: string;
  description: string;
  options: ScenarioOption[];
  targetItemId?: string;
  targetListingId?: string;
  competitorListingId?: string;
  expiresAt: number; // 90 second deadline
  resolved: boolean;
  chosenOption?: number;
  outcomeText?: string;
  votes: Record<string, number>; // Maps playerId to optionIndex
}

export interface Player {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  budget: number;
  inventory: Item[];        // items owned but not listed
  activeListings: Listing[];
  salesHistory: SaleRecord[];
  scenarios: Scenario[];
  scenarioSkipsRemaining: number;
  totalSpent: number;
  totalRevenue: number;
  players: Player[];
}

export interface RoomConfig {
  startingBudget: number;
  timerDuration: number; // seconds
  maxTeams: number;
}

export interface Room {
  code: string;
  status: RoomStatus;
  config: RoomConfig;
  facilitatorId: string;
  teams: Team[];
  marketplace: Listing[];  // all available listings (store + player)
  startedAt?: number;
  endsAt?: number;
}

// ===== SSE Event Types =====

export type SSEEventType =
  | 'connected'
  | 'marketplace-update'
  | 'team-update'
  | 'leaderboard-update'
  | 'scenario-event'
  | 'undercut-alert'
  | 'sale-completed'
  | 'game-started'
  | 'game-over'
  | 'team-joined'
  | 'item-purchased'
  | 'activity-log';

export interface SSEEvent {
  id?: number;
  type: SSEEventType;
  data: unknown;
  timestamp: number;
}

// ===== API Request/Response Types =====

export interface CreateRoomRequest {
  startingBudget: number;
  timerDuration: number;
  maxTeams: number;
}

export interface JoinRoomRequest {
  playerName: string;
  teamName: string;
}

export interface BuyItemRequest {
  teamId: string;
  listingId: string;
}

export interface ListItemRequest {
  teamId: string;
  itemId: string;
  askingPrice: number;
}

export interface ScenarioResponseRequest {
  teamId: string;
  playerId: string;
  scenarioId: string;
  optionIndex: number;
}

export interface UnlistItemRequest {
  teamId: string;
  listingId: string;
}

// ===== Leaderboard =====

export interface LeaderboardEntry {
  teamId: string;
  teamName: string;
  teamColor: string;
  netProfit: number;
  itemsSold: number;
  rank: number;
}
