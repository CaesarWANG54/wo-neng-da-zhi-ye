import { beforeAll, describe, expect, it } from "vitest";
import { createPlayerProfile, leagueTeams } from "./player-creation";
import {
  CAREER_SEASON_END,
  createCareerSeason,
  getCareerSeasonBounds,
  simulateCareerToDate,
  type CareerSeasonState,
} from "./career-season";
import {
  POSTSEASON_SCHEMA_VERSION,
  RANKING_RULES_VERSION,
  assertFrozenConsistency,
  conferenceQualifiers,
  freezeRegularSeason,
  isPostseasonState,
  nextPlayInGame,
  nextSeriesGame,
  orderTiedTeams,
  playInComplete,
  recordPlayInResult,
  recordPostseasonPlayoffResult,
  simulateNextPlayInGame,
  type Conference,
  type PostseasonState,
  type TeamTieBreakEvidence,
} from "./career-postseason";

function completeSeasonFixture(): CareerSeasonState {
  const profile = createPlayerProfile({ displayName: "测试新秀", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 0 });
  return simulateCareerToDate(createCareerSeason("WIZARDS", profile.displayName, 20_260_901), CAREER_SEASON_END, profile.ratings);
}

function evidence(
  teamId: string,
  overrides: Partial<TeamTieBreakEvidence> = {},
): TeamTieBreakEvidence {
  return {
    teamId,
    division: "ATLANTIC",
    divisionWinner: false,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    divisionWins: 0,
    divisionLosses: 0,
    conferenceWins: 0,
    conferenceLosses: 0,
    eligibleConferenceWins: 0,
    eligibleConferenceLosses: 0,
    eligibleOppositeWins: 0,
    eligibleOppositeLosses: 0,
    opponent: {},
    ...overrides,
  };
}

function withOpponent(team: TeamTieBreakEvidence, opponentId: string, wins: number, losses: number): TeamTieBreakEvidence {
  return {
    ...team,
    opponent: { ...team.opponent, [opponentId]: { wins, losses } },
  };
}

const scoreFor = (homeWins: boolean) => (homeWins ? { homeScore: 112, awayScore: 101 } : { homeScore: 99, awayScore: 108 });

describe("M6B-1 regular-season freeze", () => {
  let season: CareerSeasonState;
  beforeAll(() => {
    season = completeSeasonFixture();
  });

  it("has all 1,230 regular-season games FINAL in the fixture", () => {
    expect(season.games).toHaveLength(1_230);
    expect(season.cupResolved).toBe(true);
    expect(season.games.filter((game) => game.status !== "FINAL")).toHaveLength(0);
  });

  it("cannot freeze with one unfinished game", () => {
    const profile = createPlayerProfile({ displayName: "测试新秀", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 0 });
    const baseSeason = createCareerSeason("WIZARDS", profile.displayName, 20_260_901);
    const playerGame = simulateCareerToDate(baseSeason, CAREER_SEASON_END, profile.ratings)
      .games.find((game) => game.awayTeamId === "WIZARDS" || game.homeTeamId === "WIZARDS")!;
    // Simulate the whole season while deferring exactly one player game.
    const deferred = simulateCareerToDate(baseSeason, CAREER_SEASON_END, profile.ratings, { deferGameIds: [playerGame.id] });
    expect(deferred.games.filter((game) => game.status !== "FINAL")).toHaveLength(1);
    const result = freezeRegularSeason(deferred);
    expect(result.status).toBe("NOT_READY");
    if (result.status === "NOT_READY") {
      expect(result.unfinishedCount).toBe(1);
      expect(result.reason).toContain("未结束");
    }
  });

  it("rejects a nominally complete table unless every team has exactly 82 games", () => {
    const corrupt = structuredClone(season);
    const game = corrupt.games[0];
    const replacement = leagueTeams.find((team) => team.id !== game.awayTeamId && team.id !== game.homeTeamId)!;
    game.awayTeamId = replacement.id;
    const result = freezeRegularSeason(corrupt);
    expect(result.status).toBe("NOT_READY");
    if (result.status === "NOT_READY") expect(result.reason).toContain("应为 82");
  });

  it("freezes once into exactly two immutable 15-team snapshots", () => {
    const first = freezeRegularSeason(season);
    expect(first.status).toBe("FROZEN");
    if (first.status !== "FROZEN") return;
    const state = first.state;
    expect(state.schemaVersion).toBe(POSTSEASON_SCHEMA_VERSION);
    expect(state.rankingRulesVersion).toBe(RANKING_RULES_VERSION);
    expect(state.frozen).toBe(true);
    expect(state.eventIds).toEqual([state.freezeEventId]);
    expect(state.east.teams).toHaveLength(15);
    expect(state.west.teams).toHaveLength(15);
    const eastIds = new Set(state.east.teams.map((entry) => entry.teamId));
    const westIds = new Set(state.west.teams.map((entry) => entry.teamId));
    expect(eastIds.size).toBe(15);
    expect(westIds.size).toBe(15);
    expect([...eastIds].some((id) => westIds.has(id))).toBe(false);
    // Conference membership and shape are enforced by the validator.
    expect(isPostseasonState(state)).toBe(true);
    expect(state.east.teams.map((entry) => entry.rank)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(state.west.teams.map((entry) => entry.rank)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    // Immutable: repeated freeze returns the existing state untouched.
    const second = freezeRegularSeason(season, state);
    expect(second.status).toBe("ALREADY_FROZEN");
    if (second.status === "ALREADY_FROZEN") {
      expect(second.state).toBe(state);
      expect(second.state.eventIds).toEqual([state.freezeEventId]);
    }
    expect(isPostseasonState(state)).toBe(true);
    // JSON round-trip restores identical state (refresh identity).
    const revived = JSON.parse(JSON.stringify(state)) as PostseasonState;
    expect(revived).toEqual(state);
    expect(isPostseasonState(revived)).toBe(true);
  });

  it("names future-season freeze events with the shifted season year without changing season one", () => {
    const first = freezeRegularSeason(season);
    if (first.status !== "FROZEN") throw new Error("season-one freeze failed");
    expect(first.state.freezeEventId).toMatch(/^postseason-freeze-2026-[0-9a-f]{8}$/);

    const profile = createPlayerProfile({ displayName: "跨季测试", position: "PG", templateId: "PG_FLOOR_GENERAL", jerseyNumber: 0 });
    const bounds = getCareerSeasonBounds(2);
    const futureSeason = simulateCareerToDate(
      createCareerSeason("WIZARDS", profile.displayName, 20_260_901, 2),
      bounds.endDate,
      profile.ratings,
    );
    const future = freezeRegularSeason(futureSeason);
    if (future.status !== "FROZEN") throw new Error("future-season freeze failed");
    expect(future.state.freezeEventId).toMatch(/^postseason-freeze-2027-[0-9a-f]{8}$/);
    expect(future.state.freezeEventId).not.toBe(first.state.freezeEventId);
    expect(() => assertFrozenConsistency(futureSeason, future.state)).not.toThrow();
  });

  it("rejects an existing frozen snapshot from a different final schedule", () => {
    const first = freezeRegularSeason(season);
    if (first.status !== "FROZEN") throw new Error("freeze failed");
    const changed = structuredClone(season);
    const game = changed.games[0];
    if (!game.result) throw new Error("missing result");
    game.result.awayScore += game.result.awayScore + 1 === game.result.homeScore ? 2 : 1;
    const second = freezeRegularSeason(changed, first.state);
    expect(second.status).toBe("REJECTED");
    if (second.status === "REJECTED") expect(second.code).toBe("MISMATCH");
  });

  it("seeds 1-6 are direct qualifiers and never appear in play-in games", () => {
    const state = freezeRegularSeason(season);
    if (state.status !== "FROZEN") throw new Error("freeze failed");
    for (const conference of ["EAST", "WEST"] as const) {
      const bracket = state.state.playIn[conference];
      expect(bracket.directQualifierTeamIds).toHaveLength(6);
      expect(bracket.gameA.homeSeed).toBe(7);
      expect(bracket.gameA.awaySeed).toBe(8);
      expect(bracket.gameB.homeSeed).toBe(9);
      expect(bracket.gameB.awaySeed).toBe(10);
      const direct = new Set(bracket.directQualifierTeamIds);
      for (const game of [bracket.gameA, bracket.gameB]) {
        expect(direct.has(game.homeTeamId)).toBe(false);
        expect(direct.has(game.awayTeamId)).toBe(false);
      }
    }
  });
});

describe("M6B-1 tie-break procedures", () => {
  it("two-team tie: head-to-head decides", () => {
    const first = evidence("CELTICS", { division: "ATLANTIC", conferenceWins: 30, conferenceLosses: 20, divisionWins: 6, divisionLosses: 2, wins: 48, losses: 34 });
    const second = withOpponent(evidence("KNICKS", { division: "ATLANTIC", conferenceWins: 30, conferenceLosses: 20, divisionWins: 6, divisionLosses: 2, wins: 48, losses: 34 }), "CELTICS", 1, 3);
    const firstWithHead = withOpponent(first, "KNICKS", 3, 1);
    expect(orderTiedTeams([firstWithHead, second])).toEqual(["CELTICS", "KNICKS"]);
    expect(orderTiedTeams([second, firstWithHead])).toEqual(["CELTICS", "KNICKS"]);
  });

  it("two-team tie: division record decides when head-to-head is unavailable", () => {
    const first = evidence("BULLS", { division: "CENTRAL", conferenceWins: 30, conferenceLosses: 20, divisionWins: 9, divisionLosses: 1, wins: 50, losses: 32 });
    const second = evidence("BUCKS", { division: "CENTRAL", conferenceWins: 30, conferenceLosses: 20, divisionWins: 7, divisionLosses: 3, wins: 50, losses: 32 });
    expect(orderTiedTeams([first, second])).toEqual(["BULLS", "BUCKS"]);
  });

  it("two-team tie: a resolved division winner ranks ahead before division and conference records", () => {
    const divisionWinner = evidence("HAWKS", {
      division: "SOUTHEAST",
      divisionWinner: true,
      wins: 48,
      losses: 34,
      conferenceWins: 25,
      conferenceLosses: 27,
    });
    const other = evidence("CELTICS", {
      division: "ATLANTIC",
      divisionWinner: false,
      wins: 48,
      losses: 34,
      conferenceWins: 35,
      conferenceLosses: 17,
    });
    expect(orderTiedTeams([other, divisionWinner])).toEqual(["HAWKS", "CELTICS"]);
  });

  it("multi-team tie applies division-winner status first, then restarts two-team rules for the remainder", () => {
    const winner = evidence("HAWKS", { divisionWinner: true, wins: 47, losses: 35, pointsFor: 8_100, pointsAgainst: 8_000 });
    const betterOpposite = evidence("CELTICS", {
      wins: 47,
      losses: 35,
      eligibleOppositeWins: 20,
      eligibleOppositeLosses: 0,
      pointsFor: 8_050,
      pointsAgainst: 8_000,
    });
    const betterDifferential = evidence("KNICKS", {
      wins: 47,
      losses: 35,
      eligibleOppositeWins: 0,
      eligibleOppositeLosses: 20,
      pointsFor: 8_200,
      pointsAgainst: 8_000,
    });
    expect(orderTiedTeams([betterOpposite, betterDifferential, winner])).toEqual([
      "HAWKS",
      "CELTICS",
      "KNICKS",
    ]);
  });

  it("multi-team complete break uses point differential without an opposite-conference criterion", () => {
    const best = evidence("CELTICS", {
      wins: 47, losses: 35, eligibleOppositeWins: 0, eligibleOppositeLosses: 20,
      pointsFor: 8_300, pointsAgainst: 8_000,
    });
    const middle = evidence("KNICKS", {
      wins: 47, losses: 35, eligibleOppositeWins: 10, eligibleOppositeLosses: 10,
      pointsFor: 8_200, pointsAgainst: 8_000,
    });
    const last = evidence("NETS", {
      wins: 47, losses: 35, eligibleOppositeWins: 20, eligibleOppositeLosses: 0,
      pointsFor: 8_100, pointsAgainst: 8_000,
    });
    expect(orderTiedTeams([last, middle, best])).toEqual(["CELTICS", "KNICKS", "NETS"]);
  });

  it("two-team tie uses opposite-conference eligible record before point differential", () => {
    const first = evidence("CELTICS", {
      division: "ATLANTIC",
      wins: 46,
      losses: 36,
      eligibleOppositeWins: 2,
      eligibleOppositeLosses: 8,
      pointsFor: 8_300,
      pointsAgainst: 8_000,
    });
    const second = evidence("HAWKS", {
      division: "SOUTHEAST",
      wins: 46,
      losses: 36,
      eligibleOppositeWins: 8,
      eligibleOppositeLosses: 2,
      pointsFor: 8_050,
      pointsAgainst: 8_000,
    });
    expect(orderTiedTeams([first, second])).toEqual(["HAWKS", "CELTICS"]);
  });

  it("three-team partial tie: head-to-head separates the best, then two-team restarts", () => {
    // All three tied at 50-32. Head-to-head: A beat B and C; B and C split 1-1.
    const a = evidence("CELTICS", { wins: 50, losses: 32, conferenceWins: 32, conferenceLosses: 18, divisionWins: 7, divisionLosses: 3 });
    const b = evidence("NUGGETS", { wins: 50, losses: 32, conferenceWins: 32, conferenceLosses: 18, divisionWins: 8, divisionLosses: 2 });
    const c = evidence("WARRIORS", { wins: 50, losses: 32, conferenceWins: 32, conferenceLosses: 18, divisionWins: 8, divisionLosses: 2 });
    const aFull = withOpponent(withOpponent(a, "NUGGETS", 2, 0), "WARRIORS", 2, 0);
    const bFull = withOpponent(withOpponent(b, "CELTICS", 0, 2), "WARRIORS", 1, 1);
    const cFull = withOpponent(withOpponent(c, "CELTICS", 0, 2), "NUGGETS", 1, 1);
    const ordered = orderTiedTeams([aFull, bFull, cFull]);
    expect(ordered[0]).toBe("CELTICS");
    // Remaining two restart: B vs C head-to-head is split 1-1, so division
    // record (same-division check fails — different divisions), then
    // conference record is equal, then the reproducible random draw fallback.
    const tail = ordered.slice(1);
    expect(new Set(tail)).toEqual(new Set(["NUGGETS", "WARRIORS"]));
    expect(orderTiedTeams([cFull, bFull, aFull])).toEqual(ordered);
  });

  it("treats a simplified sort as incomplete: exact same record but tie-break evidence changes order", () => {
    const first = evidence("HEAT", { division: "SOUTHEAST", wins: 45, losses: 37, conferenceWins: 30, conferenceLosses: 20, pointsFor: 9000, pointsAgainst: 8800 });
    const second = withOpponent(evidence("MAGIC", { division: "SOUTHEAST", wins: 45, losses: 37, conferenceWins: 30, conferenceLosses: 20, pointsFor: 9200, pointsAgainst: 8700 }), "HEAT", 3, 1);
    const firstWithHead = withOpponent(first, "MAGIC", 1, 3);
    // Magic wins the head-to-head 3-1 despite the worse point differential.
    expect(orderTiedTeams([firstWithHead, second])).toEqual(["MAGIC", "HEAT"]);
  });
});

describe("M6B-1 play-in state machine", () => {
  let season: CareerSeasonState;
  let frozen: PostseasonState;
  let eastSeed7: string;
  let eastSeed8: string;
  let eastSeed9: string;
  let eastSeed10: string;
  let westSeed7: string;
  let westSeed8: string;
  let westSeed9: string;
  let westSeed10: string;

  beforeAll(() => {
    season = completeSeasonFixture();
    const result = freezeRegularSeason(season);
    if (result.status !== "FROZEN") throw new Error("fixture freeze failed");
    frozen = result.state;
    const seedTeam = (conference: Conference, seed: number) => {
      const snapshot = conference === "EAST" ? frozen.east : frozen.west;
      return snapshot.teams.find((entry) => entry.playInSeed === seed)!.teamId;
    };
    eastSeed7 = seedTeam("EAST", 7);
    eastSeed8 = seedTeam("EAST", 8);
    eastSeed9 = seedTeam("EAST", 9);
    eastSeed10 = seedTeam("EAST", 10);
    westSeed7 = seedTeam("WEST", 7);
    westSeed8 = seedTeam("WEST", 8);
    westSeed9 = seedTeam("WEST", 9);
    westSeed10 = seedTeam("WEST", 10);
  });

  it("rejects tied finals and out-of-order C resolution", () => {
    let state = frozen;
    const tied = recordPlayInResult(state, "EAST", "A", { homeScore: 100, awayScore: 100 });
    expect(tied.status).toBe("REJECTED");
    if (tied.status === "REJECTED") expect(tied.code).toBe("TIED");
    // No C exists until A and B are both FINAL.
    const cBeforeAB = recordPlayInResult(state, "EAST", "C", scoreFor(true));
    expect(cBeforeAB.status).toBe("REJECTED");
    if (cBeforeAB.status === "REJECTED") expect(cBeforeAB.code).toBe("OUT_OF_ORDER");
    expect(state.playIn.EAST.gameC).toBeNull();
  });

  it("EAST: seed 8 beats 7 (A), seed 10 beats 9 (B), original 7 beats original 10 (C)", () => {
    let state = frozen;
    const a = recordPlayInResult(state, "EAST", "A", scoreFor(false)); // away (seed 8) wins
    expect(a.status).toBe("APPLIED");
    if (a.status !== "APPLIED") return;
    state = a.state;
    expect(state.playIn.EAST.finalSeed7TeamId).toBe(eastSeed8);
    const b = recordPlayInResult(state, "EAST", "B", scoreFor(false)); // away (seed 10) wins
    expect(b.status).toBe("APPLIED");
    if (b.status !== "APPLIED") return;
    state = b.state;
    // C is now generated: A loser (seed 7) hosts B winner (seed 10).
    const c = state.playIn.EAST.gameC;
    expect(c).not.toBeNull();
    expect(c!.homeTeamId).toBe(eastSeed7);
    expect(c!.awayTeamId).toBe(eastSeed10);
    const recorded = recordPlayInResult(state, "EAST", "C", scoreFor(true)); // home (seed 7) wins
    expect(recorded.status).toBe("APPLIED");
    if (recorded.status !== "APPLIED") return;
    state = recorded.state;
    expect(state.playIn.EAST.finalSeed8TeamId).toBe(eastSeed7);
    expect(playInComplete(state, "EAST")).toBe(true);
    expect(conferenceQualifiers(state, "EAST")).toHaveLength(8);
  });

  it("WEST: seed 7 beats 8 (A), seed 9 beats 10 (B), seed 9 beats original 8 (C)", () => {
    let state = frozen;
    const a = recordPlayInResult(state, "WEST", "A", scoreFor(true)); // home (seed 7) wins
    expect(a.status).toBe("APPLIED");
    if (a.status !== "APPLIED") return;
    state = a.state;
    expect(state.playIn.WEST.finalSeed7TeamId).toBe(westSeed7);
    const b = recordPlayInResult(state, "WEST", "B", scoreFor(true)); // home (seed 9) wins
    expect(b.status).toBe("APPLIED");
    if (b.status !== "APPLIED") return;
    state = b.state;
    const c = state.playIn.WEST.gameC;
    expect(c!.homeTeamId).toBe(westSeed8); // A loser (seed 8) hosts
    expect(c!.awayTeamId).toBe(westSeed9); // B winner (seed 9) visits
    const recorded = recordPlayInResult(state, "WEST", "C", scoreFor(false)); // away (seed 9) wins
    expect(recorded.status).toBe("APPLIED");
    if (recorded.status !== "APPLIED") return;
    state = recorded.state;
    expect(state.playIn.WEST.finalSeed8TeamId).toBe(westSeed9);
    expect(playInComplete(state, "WEST")).toBe(true);
  });

  it("covers all 2x2x2 outcome combinations per conference with invariants intact", () => {
    for (const conference of ["EAST", "WEST"] as const) {
      const snap = conference === "EAST" ? frozen.east : frozen.west;
      const seeds = new Map<number, string>();
      for (const entry of snap.teams) if (entry.playInSeed !== null) seeds.set(entry.playInSeed, entry.teamId);
      for (let aBit = 0; aBit < 2; aBit += 1) {
        for (let bBit = 0; bBit < 2; bBit += 1) {
          for (let cBit = 0; cBit < 2; cBit += 1) {
            let state = frozen;
            const a = recordPlayInResult(state, conference, "A", scoreFor(aBit === 0));
            if (a.status !== "APPLIED") throw new Error("A failed");
            state = a.state;
            const b = recordPlayInResult(state, conference, "B", scoreFor(bBit === 0));
            if (b.status !== "APPLIED") throw new Error("B failed");
            state = b.state;
            const c = recordPlayInResult(state, conference, "C", scoreFor(cBit === 0));
            if (c.status !== "APPLIED") throw new Error("C failed");
            state = c.state;
            const bracket = state.playIn[conference];
            const aWinner = aBit === 0 ? seeds.get(7)! : seeds.get(8)!;
            const bWinner = bBit === 0 ? seeds.get(9)! : seeds.get(10)!;
            const bLoser = bBit === 0 ? seeds.get(10)! : seeds.get(9)!;
            const aLoser = aBit === 0 ? seeds.get(8)! : seeds.get(7)!;
            const cWinner = cBit === 0 ? aLoser : bWinner;
            const cLoser = cBit === 0 ? bWinner : aLoser;
            expect(bracket.finalSeed7TeamId).toBe(aWinner);
            expect(bracket.finalSeed8TeamId).toBe(cWinner);
            expect(bracket.finalSeed7TeamId).not.toBe(bracket.finalSeed8TeamId);
            expect(playInComplete(state, conference)).toBe(true);
            const qualifiers = conferenceQualifiers(state, conference);
            expect(qualifiers).toHaveLength(8);
            expect(new Set(qualifiers).size).toBe(8);
            expect(bracket.eliminatedTeamIds).toEqual([bLoser, cLoser]);
            for (const teamId of qualifiers) {
              expect(snap.teams.some((entry) => entry.teamId === teamId)).toBe(true);
            }
            expect(isPostseasonState(state)).toBe(true);
          }
        }
      }
    }
  });

  it("rejects a conflicting replay and treats identical replays as no-ops", () => {
    let state = frozen;
    const applied = recordPlayInResult(state, "EAST", "A", scoreFor(true));
    if (applied.status !== "APPLIED") throw new Error("A failed");
    state = applied.state;
    const revisionAfterApply = state.revision;
    const eventCountAfterApply = state.eventIds.length;
    const noop = recordPlayInResult(state, "EAST", "A", scoreFor(true));
    expect(noop.status).toBe("NOOP");
    if (noop.status === "NOOP") {
      expect(noop.state).toBe(state);
      expect(noop.state.revision).toBe(revisionAfterApply);
      expect(noop.state.eventIds).toHaveLength(eventCountAfterApply);
    }
    const conflict = recordPlayInResult(state, "EAST", "A", scoreFor(false));
    expect(conflict.status).toBe("REJECTED");
    if (conflict.status === "REJECTED") expect(conflict.code).toBe("CONFLICT");
  });

  it("rejects a stale scheduled-game callback without consuming a revision", () => {
    const applied = recordPlayInResult(frozen, "EAST", "A", scoreFor(true), { expectedRevision: 0 });
    if (applied.status !== "APPLIED") throw new Error("A failed");
    const stale = recordPlayInResult(applied.state, "EAST", "B", scoreFor(true), { expectedRevision: 0 });
    expect(stale.status).toBe("REJECTED");
    if (stale.status === "REJECTED") expect(stale.code).toBe("STALE");
    expect(applied.state.revision).toBe(1);
    expect(applied.state.playIn.EAST.gameB.status).toBe("SCHEDULED");
  });

  it("uses order-independent stable event IDs across interleaved conferences", () => {
    let state = frozen;
    for (const [conference, slot] of [
      ["EAST", "A"],
      ["WEST", "A"],
      ["EAST", "B"],
      ["WEST", "B"],
      ["EAST", "C"],
      ["WEST", "C"],
    ] as const) {
      const applied = recordPlayInResult(state, conference, slot, scoreFor(true), { expectedRevision: state.revision });
      if (applied.status !== "APPLIED") throw new Error(`${conference}-${slot} failed`);
      state = applied.state;
    }
    expect(state.eventIds).toHaveLength(7);
    expect(new Set(state.eventIds).size).toBe(7);
    expect(state.revision).toBe(6);
    expect(state.playIn.EAST.revision).toBe(3);
    expect(state.playIn.WEST.revision).toBe(3);
    expect(isPostseasonState(state)).toBe(true);
    expect(() => assertFrozenConsistency(season, state)).not.toThrow();
  });

  it("keeps stable identity after refresh at every play-in stage", () => {
    let state = frozen;
    for (const conference of ["EAST", "WEST"] as const) {
      for (const slot of ["A", "B"] as const) {
        const applied = recordPlayInResult(state, conference, slot, scoreFor(true));
        if (applied.status !== "APPLIED") throw new Error(`${conference} ${slot} failed`);
        state = applied.state;
      }
      const cApplied = recordPlayInResult(state, conference, "C", scoreFor(true));
      if (cApplied.status !== "APPLIED") throw new Error(`${conference} C failed`);
      state = cApplied.state;
      expect(isPostseasonState(state)).toBe(true);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  it("deterministically simulates non-player play-in games to completion", () => {
    let state = frozen;
    let guard = 0;
    while ((!playInComplete(state, "EAST") || !playInComplete(state, "WEST")) && guard < 12) {
      for (const conference of ["EAST", "WEST"] as const) {
        const next = nextPlayInGame(state, conference);
        if (next) {
          const result = simulateNextPlayInGame(state, conference, 9_876_543 + guard);
          if (result.status === "APPLIED") state = result.state;
        }
      }
      guard += 1;
    }
    expect(guard).toBeLessThan(12);
    expect(playInComplete(state, "EAST")).toBe(true);
    expect(playInComplete(state, "WEST")).toBe(true);
    expect(conferenceQualifiers(state, "EAST")).toHaveLength(8);
    expect(conferenceQualifiers(state, "WEST")).toHaveLength(8);
    // Simulating after completion is a no-op.
    const done = simulateNextPlayInGame(state, "EAST", 1);
    expect(done.status).toBe("NOOP");
  });

  it("uses the root postseason revision for series callbacks and maps it to the bracket revision", () => {
    let state = frozen;
    for (const conference of ["EAST", "WEST"] as const) {
      for (const slot of ["A", "B", "C"] as const) {
        const result = recordPlayInResult(state, conference, slot, scoreFor(true), { expectedRevision: state.revision });
        if (result.status !== "APPLIED") throw new Error(`${conference}-${slot} failed`);
        state = result.state;
      }
    }
    const series = state.playoffs.series[0];
    const game = nextSeriesGame(state, series.seriesId);
    if (!game) throw new Error("missing first playoff game");
    const beforeRootRevision = state.revision;
    const beforeBracketRevision = state.playoffs.revision;
    const stale = recordPostseasonPlayoffResult(
      state,
      series.seriesId,
      game.gameNumber,
      scoreFor(true),
      { expectedRevision: state.revision - 1 },
    );
    expect(stale.status).toBe("REJECTED");
    if (stale.status === "REJECTED") expect(stale.code).toBe("STALE");
    expect(state.revision).toBe(beforeRootRevision);
    expect(state.playoffs.revision).toBe(beforeBracketRevision);

    const applied = recordPostseasonPlayoffResult(
      state,
      series.seriesId,
      game.gameNumber,
      scoreFor(true),
      { expectedRevision: state.revision },
    );
    expect(applied.status).toBe("APPLIED");
    if (applied.status !== "APPLIED") return;
    expect(applied.state.revision).toBe(beforeRootRevision + 1);
    expect(applied.state.playoffs.revision).toBe(beforeBracketRevision + 1);
    expect(isPostseasonState(applied.state)).toBe(true);
  });
});
