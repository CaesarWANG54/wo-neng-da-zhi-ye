import type { BoxScoreLine, CourtPlayer, MatchState, MotionIntent, Ratings } from "./types";
import { assertRatings } from "./ratings";
import { initializeTenPlayerStats } from "./player-stats";

export const CREATED_PLAYER_ID = "h1";

const guardRatings: Ratings = {
  closeShot: 70,
  layup: 72,
  drivingDunk: 68,
  standingDunk: 45,
  postFinish: 58,
  drawFoul: 68,
  midRange: 72,
  threePoint: 72,
  freeThrow: 74,
  pullUpShot: 72,
  catchShoot: 72,
  shotConsistency: 72,
  ballHandle: 70,
  ballSecurity: 70,
  passAccuracy: 70,
  passVision: 70,
  passSpeed: 70,
  offBallMovement: 70,
  decisionSpeed: 72,
  speed: 72,
  speedWithBall: 70,
  acceleration: 73,
  strength: 65,
  vertical: 70,
  stamina: 78,
  agility: 73,
  perimeterDefense: 72,
  interiorDefense: 55,
  steal: 70,
  block: 50,
  lateralQuickness: 73,
  screenNavigation: 70,
  helpDefenseIQ: 70,
  defenseConsistency: 70,
  offensiveRebound: 52,
  defensiveRebound: 60,
  basketballIQ: 72,
  hands: 74,
};

const wingRatings: Ratings = {
  ...guardRatings,
  standingDunk: 55,
  postFinish: 65,
  drivingDunk: 74,
  strength: 72,
  threePoint: 76,
  layup: 75,
  perimeterDefense: 74,
  helpDefenseIQ: 73,
  offensiveRebound: 60,
  defensiveRebound: 70,
};

const bigRatings: Ratings = {
  ...guardRatings,
  closeShot: 79,
  layup: 78,
  drivingDunk: 80,
  standingDunk: 82,
  postFinish: 76,
  drawFoul: 72,
  midRange: 70,
  threePoint: 67,
  freeThrow: 68,
  pullUpShot: 66,
  catchShoot: 70,
  shotConsistency: 70,
  ballHandle: 58,
  ballSecurity: 68,
  passAccuracy: 68,
  passVision: 64,
  passSpeed: 65,
  offBallMovement: 69,
  decisionSpeed: 70,
  speed: 65,
  speedWithBall: 55,
  acceleration: 62,
  strength: 82,
  vertical: 76,
  stamina: 76,
  agility: 60,
  hands: 76,
  perimeterDefense: 58,
  interiorDefense: 80,
  steal: 55,
  block: 79,
  lateralQuickness: 57,
  screenNavigation: 56,
  helpDefenseIQ: 78,
  defenseConsistency: 76,
  offensiveRebound: 78,
  defensiveRebound: 80,
  basketballIQ: 74,
};

export const players: CourtPlayer[] = [
  { id: CREATED_PLAYER_ID, team: "home", number: 1, position: "PG", x: 39, y: 18, ratings: { ...guardRatings, ballHandle: 80, passAccuracy: 78, passVision: 79, basketballIQ: 80, threePoint: 79 } },
  { id: "h2", team: "home", number: 2, position: "SG", x: 49, y: 83, ratings: { ...guardRatings, speed: 80, threePoint: 77 } },
  { id: "h3", team: "home", number: 3, position: "SF", x: 27, y: 48, ratings: wingRatings },
  { id: "h4", team: "home", number: 4, position: "PF", x: 12, y: 84, ratings: { ...bigRatings, threePoint: 73, interiorDefense: 74 } },
  {
    id: "h5",
    team: "home",
    number: 5,
    position: "C",
    x: 40,
    y: 38,
    ratings: { ...bigRatings, strength: 85, basketballIQ: 79, stamina: 80 },
  },
  { id: "a7", team: "away", number: 7, position: "PG", x: 59, y: 22, ratings: { ...guardRatings, perimeterDefense: 79, screenNavigation: 78 } },
  { id: "a8", team: "away", number: 8, position: "SG", x: 46, y: 64, ratings: { ...guardRatings, steal: 78 } },
  { id: "a9", team: "away", number: 9, position: "SF", x: 34, y: 31, ratings: { ...wingRatings, perimeterDefense: 80, screenNavigation: 79 } },
  { id: "a11", team: "away", number: 11, position: "PF", x: 33, y: 58, ratings: { ...bigRatings, perimeterDefense: 70, interiorDefense: 79 } },
  { id: "a23", team: "away", number: 23, position: "C", x: 62, y: 65, ratings: { ...bigRatings, interiorDefense: 84, block: 85 } },
];

players.forEach((player) => assertRatings(player.ratings, player.id));

export const playerById = new Map(players.map((player) => [player.id, player]));

export const playerDisplayNames = new Map<string, string>([
  ["h1", "Rookie One"],
  ["h2", "Preston Vale"],
  ["h3", "Cameron Locke"],
  ["h4", "Emmett Rowan"],
  ["h5", "Tobias Mercer"],
  ["a7", "Nolan Keats"],
  ["a8", "Darius Wren"],
  ["a9", "Micah Corbin"],
  ["a11", "Elias North"],
  ["a23", "Silas Garner"],
]);

/**
 * Stable half-court starting spots for the five basketball roles.  The
 * created player keeps the h1 identity, but their geometry follows the role
 * selected during creation instead of the historical h1/point-guard slot.
 */
export const homeSetFormation: Readonly<Record<CourtPlayer["position"], Readonly<{ x: number; y: number }>>> = {
  PG: { x: 42, y: 50 },
  SG: { x: 32, y: 17 },
  SF: { x: 31, y: 83 },
  PF: { x: 20, y: 74 },
  C: { x: 16, y: 49 },
};

const allBasketballPositions: readonly CourtPlayer["position"][] = ["PG", "SG", "SF", "PF", "C"];

function samePositionMatchups(): Record<string, string> {
  const awayByPosition = new Map(
    players
      .filter((player) => player.team === "away")
      .map((player) => [player.position, player.id]),
  );
  return Object.fromEntries(
    players
      .filter((player) => player.team === "home")
      .map((player) => {
        const opponentId = awayByPosition.get(player.position);
        if (!opponentId) throw new Error(`Missing away ${player.position} matchup`);
        return [player.id, opponentId];
      }),
  );
}

function replaceRecord(target: Record<string, string>, source: Record<string, string>) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function syncConfiguredMatchGeometry() {
  const positions = Object.fromEntries(players.map((player) => [player.id, { x: player.x, y: player.y }]));
  initialMatchState.currentMatchups = { ...baseMatchups };
  initialMatchState.possession = "home";
  initialMatchState.createdPlayerId = CREATED_PLAYER_ID;
  initialMatchState.controlledPlayerId = CREATED_PLAYER_ID;
  initialMatchState.ballHandlerId = CREATED_PLAYER_ID;
  initialMatchState.motion = {
    positions,
    velocities: Object.fromEntries(players.map((player) => [player.id, { x: 0, y: 0 }])),
    routes: {},
    intents: Object.fromEntries(players.map((player) => [player.id, player.id === CREATED_PLAYER_ID ? "HANDLE" : "HOLD"])),
    clock: 0,
    frame: 0,
    lastActionOwnerId: undefined,
  };
}

export function configureCreatedPlayer(input: { displayName: string; number: CourtPlayer["number"]; position: CourtPlayer["position"]; ratings: Ratings }) {
  const controlled = playerById.get(CREATED_PLAYER_ID);
  if (!controlled) throw new Error("Missing controlled player");
  controlled.number = input.number;
  controlled.position = input.position;
  controlled.ratings = { ...input.ratings };
  playerDisplayNames.set(controlled.id, input.displayName);
  const remainingPositions = allBasketballPositions.filter(
    (position) => position !== input.position,
  );
  players
    .filter((player) => player.team === "home" && player.id !== controlled.id)
    .forEach((player, index) => {
      player.position = remainingPositions[index];
    });
  for (const player of players.filter((candidate) => candidate.team === "home")) {
    const spot = homeSetFormation[player.position];
    player.x = spot.x;
    player.y = spot.y;
  }
  replaceRecord(baseMatchups, samePositionMatchups());
  syncConfiguredMatchGeometry();
  assertRatings(controlled.ratings, controlled.id);
}

export const baseMatchups: Record<string, string> = samePositionMatchups();

const initialPositions = Object.fromEntries(players.map((player) => [player.id, { x: player.x, y: player.y }]));
const initialVelocities = Object.fromEntries(players.map((player) => [player.id, { x: 0, y: 0 }]));
const initialIntents: Record<string, MotionIntent> = Object.fromEntries(
  players.map((player) => [player.id, player.id === CREATED_PLAYER_ID ? "HANDLE" : "HOLD"]),
);

const emptyStats = (): BoxScoreLine => ({
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  made: 0,
  attempts: 0,
  threesMade: 0,
  threesAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  personalFouls: 0,
});

export const initialMatchState: MatchState = {
  seed: 20_260_901,
  version: 1,
  decisionEpoch: 1,
  eventSequence: 1,
  phaseToken: "set_offense-1",
  homeScore: 60,
  awayScore: 60,
  initialHomeScore: 60,
  initialAwayScore: 60,
  gameSeconds: 180,
  shotClock: 24,
  inboundClock: null,
  backcourtClock: null,
  frontcourtEstablished: true,
  fastbreakClock: null,
  transitionClock: null,
  aiDecisionClock: null,
  intentionalFoulClock: null,
  period: 4,
  overtime: 0,
  openingTipWinner: "home",
  rules: {
    regulationPeriodSeconds: 180,
    overtimePeriodSeconds: 75,
    fullShotClockSeconds: 24,
    offensiveReboundSeconds: 14,
    inboundSeconds: 5,
    backcourtSeconds: 8,
    fastbreakSeconds: 6,
  },
  possession: "home",
  difficulty: "ROOKIE",
  phase: "SET_OFFENSE",
  createdPlayerId: CREATED_PLAYER_ID,
  controlledPlayerId: CREATED_PLAYER_ID,
  ballHandlerId: CREATED_PLAYER_ID,
  currentMatchups: { ...baseMatchups },
  defenseScheme: "MAN",
  opponentPlayHistory: [],
  homeTacticSignatureHistory: [],
  homeTacticHistory: [],
  teamFouls: { home: 0, away: 0 },
  latePeriodTeamFouls: { home: 0, away: 0 },
  offensivePossessionSerial: 1,
  naturalFoulPossessions: [],
  naturalThreePointFoulPossessions: [],
  threeSecondClocks: Object.fromEntries(players.map((player) => [player.id, 0])),
  disqualifiedPlayerIds: [],
  secondChanceCount: 0,
  motion: {
    positions: initialPositions,
    velocities: initialVelocities,
    routes: {},
    intents: initialIntents,
    clock: 0,
    frame: 0,
    lastActionOwnerId: undefined,
  },
  eventLog: [
    {
      id: "opening",
      kind: "SYSTEM",
      text: "比赛继续 · 选择一次进攻",
      atGameSecond: 180,
    },
  ],
  playerStats: emptyStats(),
  opponentStats: emptyStats(),
  playerBoxScores: initializeTenPlayerStats(players),
};
