import { describe, expect, it } from "vitest";
import { averageRating, RATING_GROUPS, RATING_IDS, RATING_LABELS, validateRatings, type RatingId } from "./ratings";
import {
  assertJerseyNumber,
  createPlayerProfile,
  creationTemplateLabel,
  creationTemplates,
  generateRookieRatings,
  generateTutorialRatings,
  isValidJerseyNumber,
  jerseyNumberOrdinal,
  leagueTeams,
  resolveCareerDestination,
  stepJerseyNumber,
} from "./player-creation";
import type { Position } from "./types";

describe("30 creation templates", () => {
  it("labels and groups every one of the 38 visible attributes exactly once", () => {
    expect(Object.keys(RATING_LABELS)).toHaveLength(38);
    expect(RATING_GROUPS.flatMap((group) => group.ids)).toHaveLength(38);
    expect(new Set(RATING_GROUPS.flatMap((group) => group.ids))).toEqual(new Set(RATING_IDS));
  });
  it("publishes the required template count for every position", () => {
    const expected: Record<Position, number> = { PG: 7, SG: 6, SF: 5, PF: 6, C: 6 };
    expect(creationTemplates).toHaveLength(30);
    expect(new Set(creationTemplates.map((template) => template.id)).size).toBe(30);
    expect(new Set(creationTemplates.map((template) => template.name)).size).toBe(30);
    for (const [position, count] of Object.entries(expected) as Array<[Position, number]>) {
      expect(creationTemplates.filter((template) => template.position === position)).toHaveLength(count);
    }
  });

  it("keeps the approved references in their exact position groups", () => {
    const referencesByPosition = Object.fromEntries(
      (["PG", "SG", "SF", "PF", "C"] as Position[]).map((position) => [
        position,
        creationTemplates.filter((template) => template.position === position).map((template) => template.referenceName),
      ]),
    );
    expect(referencesByPosition).toEqual({
      PG: ["库里", "亚历山大", "莫兰特", "哈里伯顿", "东契奇", "欧文", "哈登"],
      SG: ["马克西", "米切尔", "爱德华兹", "布克", "科比", "汤普森"],
      SF: ["伦纳德", "保罗乔治", "塔图姆", "詹姆斯", "布朗"],
      PF: ["字母哥", "班凯罗", "唐斯", "锡安", "杜兰特", "邓肯"],
      C: ["约基奇", "文班亚马", "霍姆格伦", "恩比德", "戈贝尔", "奥尼尔"],
    });
  });

  it("keeps every requested player reference attached to its stable template id", () => {
    expect(Object.fromEntries(creationTemplates.map((template) => [template.id, template.referenceName]))).toEqual({
      PG_DEEP_RANGE: "库里",
      PG_MIDRANGE_CREATOR: "亚历山大",
      PG_RIM_ATTACKER: "莫兰特",
      PG_FLOOR_GENERAL: "哈里伯顿",
      PG_BIG_CREATOR: "东契奇",
      PG_ISOLATION_MAESTRO: "欧文",
      PG_PICK_ROLL_ENGINE: "哈登",
      SG_SPEED_SCORER: "马克西",
      SG_POWER_SHOOTER: "米切尔",
      SG_POWER_FINISHER: "爱德华兹",
      SG_ENGINE: "布克",
      SG_COMBO_GUARD: "科比",
      SG_MOVEMENT_SNIPER: "汤普森",
      SF_TWO_WAY_LOCK: "伦纳德",
      SF_HIGH_RELEASE: "保罗乔治",
      SF_ALL_AROUND: "塔图姆",
      SF_POINT_FORWARD: "詹姆斯",
      SF_POWER_SLASHER: "布朗",
      PF_RIM_SWEEPER: "字母哥",
      PF_PLAYMAKING_DEFENDER: "班凯罗",
      PF_STRETCH_BIG: "唐斯",
      PF_POWER_FINISHER: "锡安",
      PF_TALL_SHOTMAKER: "杜兰特",
      PF_TWO_WAY_PILLAR: "邓肯",
      C_HIGH_POST_HUB: "约基奇",
      C_LENGTH_RIM_PROTECTOR: "文班亚马",
      C_STRETCH_RIM_PROTECTOR: "霍姆格伦",
      C_MID_POST_SCORER: "恩比德",
      C_RIM_ANCHOR: "戈贝尔",
      C_PAINT_DOMINATOR: "奥尼尔",
    });
    expect(new Set(creationTemplates.map((template) => template.referenceName)).size).toBe(30);
    expect(creationTemplates.filter((template) => ["科比", "邓肯", "奥尼尔"].includes(template.referenceName)).map((template) => template.referenceName)).toEqual([
      "科比",
      "邓肯",
      "奥尼尔",
    ]);
    expect(creationTemplates.map((template) => template.referenceName)).not.toEqual(expect.arrayContaining(["布伦森", "巴恩斯", "约老师"]));
  });

  it("gives every template a unique name, label and tactical role", () => {
    const labels = creationTemplates.map(creationTemplateLabel);
    const roles = creationTemplates.map((template) => template.tacticalRole);
    expect(new Set(labels).size).toBe(30);
    expect(new Set(roles).size).toBe(30);
    for (const template of creationTemplates) {
      expect(creationTemplateLabel(template)).toBe(`${template.name}（${template.referenceName}）`);
      expect(template.description.trim()).not.toBe("");
      expect(template.tacticalRole).toMatch(/.+ · .+/);
    }
  });

  it("generates complete balanced rookie ratings with exact core peaks and explicit weaknesses", () => {
    for (const template of creationTemplates) {
      const ratings = generateRookieRatings(template.position, template.id);
      expect(Object.keys(ratings)).toHaveLength(38);
      expect(new Set(Object.keys(ratings))).toEqual(new Set(RATING_IDS));
      expect(validateRatings(ratings)).toEqual({ valid: true, errors: [] });
      expect(averageRating(ratings)).toBeGreaterThanOrEqual(69);
      expect(averageRating(ratings)).toBeLessThanOrEqual(71);
      expect(Math.min(...RATING_IDS.map((id) => ratings[id]))).toBeGreaterThanOrEqual(25);
      expect(Math.max(...RATING_IDS.map((id) => ratings[id]))).toBeLessThanOrEqual(80);
      expect(template.coreRatings[0]).not.toBe(template.coreRatings[1]);
      expect(ratings[template.coreRatings[0]]).toBe(80);
      expect(ratings[template.coreRatings[1]]).toBe(79);

      const weaknessIds = Object.keys(template.weaknesses) as RatingId[];
      expect(weaknessIds).toHaveLength(3);
      expect(weaknessIds).not.toContain(template.coreRatings[0]);
      expect(weaknessIds).not.toContain(template.coreRatings[1]);
      for (const id of weaknessIds) {
        expect(ratings[id]).toBeGreaterThanOrEqual(55);
        expect(ratings[id]).toBeLessThanOrEqual(64);
      }
      expect(Math.min(...weaknessIds.map((id) => ratings[id]))).toBeLessThanOrEqual(60);
      expect(Object.keys(template.boosts).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("maps all 30 references to their defining rookie strengths", () => {
    const expectedCores: Record<(typeof creationTemplates)[number]["id"], readonly RatingId[]> = {
      PG_DEEP_RANGE: ["threePoint", "catchShoot"],
      PG_MIDRANGE_CREATOR: ["midRange", "drawFoul"],
      PG_RIM_ATTACKER: ["speed", "drivingDunk"],
      PG_FLOOR_GENERAL: ["passVision", "passSpeed"],
      PG_BIG_CREATOR: ["ballHandle", "basketballIQ"],
      PG_ISOLATION_MAESTRO: ["ballHandle", "layup"],
      PG_PICK_ROLL_ENGINE: ["passAccuracy", "drawFoul"],
      SG_SPEED_SCORER: ["speedWithBall", "acceleration"],
      SG_POWER_SHOOTER: ["threePoint", "pullUpShot"],
      SG_POWER_FINISHER: ["drivingDunk", "strength"],
      SG_ENGINE: ["midRange", "shotConsistency"],
      SG_COMBO_GUARD: ["postFinish", "defenseConsistency"],
      SG_MOVEMENT_SNIPER: ["catchShoot", "perimeterDefense"],
      SF_TWO_WAY_LOCK: ["perimeterDefense", "midRange"],
      SF_HIGH_RELEASE: ["threePoint", "lateralQuickness"],
      SF_ALL_AROUND: ["threePoint", "defensiveRebound"],
      SF_POINT_FORWARD: ["passVision", "strength"],
      SF_POWER_SLASHER: ["drivingDunk", "perimeterDefense"],
      PF_RIM_SWEEPER: ["drivingDunk", "interiorDefense"],
      PF_PLAYMAKING_DEFENDER: ["postFinish", "passVision"],
      PF_STRETCH_BIG: ["threePoint", "closeShot"],
      PF_POWER_FINISHER: ["strength", "standingDunk"],
      PF_TALL_SHOTMAKER: ["midRange", "pullUpShot"],
      PF_TWO_WAY_PILLAR: ["interiorDefense", "defensiveRebound"],
      C_HIGH_POST_HUB: ["basketballIQ", "passAccuracy"],
      C_LENGTH_RIM_PROTECTOR: ["block", "vertical"],
      C_STRETCH_RIM_PROTECTOR: ["block", "threePoint"],
      C_MID_POST_SCORER: ["postFinish", "drawFoul"],
      C_RIM_ANCHOR: ["interiorDefense", "block"],
      C_PAINT_DOMINATOR: ["standingDunk", "strength"],
    };
    for (const template of creationTemplates) {
      expect(template.coreRatings).toEqual(expectedCores[template.id]);
    }
  });

  it("uses a stronger one-match tutorial version without changing permanent rookie ratings", () => {
    const selected = creationTemplates[0];
    const rookie = generateRookieRatings(selected.position, selected.id);
    const tutorial = generateTutorialRatings(selected.position, selected.id);
    expect(averageRating(tutorial)).toBeGreaterThan(averageRating(rookie));
    expect(tutorial[selected.coreRatings[0]]).toBe(94);
    expect(tutorial[selected.coreRatings[1]]).toBe(92);
    expect(Math.max(...RATING_IDS.map((id) => tutorial[id]))).toBeLessThanOrEqual(94);
    expect(generateRookieRatings(selected.position, selected.id)).toEqual(rookie);
  });

  it("rejects a template selected for the wrong position", () => {
    expect(() => generateRookieRatings("C", "PG_DEEP_RANGE")).toThrow(/not available/);
  });
});

describe("created player validation", () => {
  it("creates a 20-year-old profile and trims the display name", () => {
    const profile = createPlayerProfile({
      displayName: "  林远  ",
      position: "PG",
      templateId: "PG_FLOOR_GENERAL",
      jerseyNumber: 0,
    });

    expect(profile.displayName).toBe("林远");
    expect(profile.age).toBe(20);
    expect(profile.position).toBe("PG");
    expect(profile.templateName).toBe("快速分球指挥官");
    expect(profile.jerseyNumber).toBe(0);
    expect(profile.simpleAverage).toBeGreaterThanOrEqual(69);
    expect(profile.simpleAverage).toBeLessThanOrEqual(71);
  });

  it("accepts 0 through 99 plus a distinct 00 jersey number", () => {
    expect(isValidJerseyNumber(0)).toBe(true);
    expect(isValidJerseyNumber(99)).toBe(true);
    expect(isValidJerseyNumber("00")).toBe(true);
    expect(isValidJerseyNumber(-1)).toBe(false);
    expect(isValidJerseyNumber(100)).toBe(false);
    expect(isValidJerseyNumber(7.5)).toBe(false);
    expect(assertJerseyNumber(23)).toBe(23);
    expect(assertJerseyNumber("00")).toBe("00");
    expect(() => assertJerseyNumber(100)).toThrow(/0 through 99 or 00/);
  });

  it("steps both ways through the complete cyclic jersey sequence", () => {
    expect(stepJerseyNumber(0, 1)).toBe(1);
    expect(stepJerseyNumber(0, -1)).toBe("00");
    expect(stepJerseyNumber("00", -1)).toBe(99);
    expect(stepJerseyNumber(99, 1)).toBe("00");
    expect(stepJerseyNumber("00", 1)).toBe(0);
    expect(jerseyNumberOrdinal("00")).toBe(100);
  });

  it("preserves 00 in the created player profile", () => {
    const profile = createPlayerProfile({ displayName: "双零", position: "SG", templateId: "SG_ENGINE", jerseyNumber: "00" });
    expect(profile.jerseyNumber).toBe("00");
    expect(profile.templateLabel).toBe("中距离进攻引擎（布克）");
  });

  it("rejects blank names and position-template mismatches", () => {
    expect(() => createPlayerProfile({ displayName: "  ", position: "PG", templateId: "PG_DEEP_RANGE", jerseyNumber: 1 })).toThrow(/required/);
    expect(() => createPlayerProfile({ displayName: "林远", position: "C", templateId: "PG_DEEP_RANGE", jerseyNumber: 1 })).toThrow(/does not match/);
  });
});

describe("league identities and career destination", () => {
  it("provides 30 unique Chinese short names and one review-gated home color per team", () => {
    expect(leagueTeams).toHaveLength(30);
    expect(new Set(leagueTeams.map((team) => team.id)).size).toBe(30);
    expect(new Set(leagueTeams.map((team) => team.shortName)).size).toBe(30);
    expect(leagueTeams.filter((team) => team.conference === "EAST")).toHaveLength(15);
    expect(leagueTeams.filter((team) => team.conference === "WEST")).toHaveLength(15);
    for (const team of leagueTeams) {
      expect(team.shortName.trim()).not.toBe("");
      expect(team.homeColor).toMatch(/^#[0-9A-F]{6}$/);
      expect(team.contentStatus).toBe("REVIEW_REQUIRED");
    }
  });

  it("resolves draft and direct-signing destinations deterministically", () => {
    const draftRequest = { position: "SF" as const, evaluationScore: 88, seed: 0x20_260_901 };
    const first = resolveCareerDestination(draftRequest);
    const replay = resolveCareerDestination(draftRequest);
    expect(replay).toEqual(first);
    expect(first.route).toBe("DRAFT");
    expect(first.draftPick).toBeGreaterThanOrEqual(1);
    expect(first.draftPick).toBeLessThanOrEqual(30);
    expect(leagueTeams.map((team) => team.id)).toContain(first.team.id);
    if (first.draftPick === 3) expect(first.team.id).toBe("GRIZZLIES");

    const direct = resolveCareerDestination({ position: "C", evaluationScore: 42, seed: 0x51a7_2026 });
    expect(direct.route).toBe("DIRECT_SIGNING");
    expect(direct.draftPick).toBeUndefined();
    expect(leagueTeams.map((team) => team.id)).toContain(direct.team.id);
  });

  it("maps the first three picks to the reviewed order instead of team-list order", () => {
    const first = resolveCareerDestination({ position: "PG", evaluationScore: 100, seed: 1 });
    expect(first.draftPick).toBe(1);
    expect(first.team.id).toBe("WIZARDS");
  });

  it("moves stronger evaluations earlier while retaining a forced direct-signing branch", () => {
    const stronger = resolveCareerDestination({ position: "SG", evaluationScore: 95, seed: 17 });
    const weaker = resolveCareerDestination({ position: "SG", evaluationScore: 55, seed: 17 });
    expect(stronger.route).toBe("DRAFT");
    expect(weaker.route).toBe("DRAFT");
    expect(stronger.draftPick!).toBeLessThan(weaker.draftPick!);

    const forced = resolveCareerDestination({ position: "SG", evaluationScore: 95, seed: 17, forceDirectSigning: true });
    expect(forced.route).toBe("DIRECT_SIGNING");
    expect(forced.draftPick).toBeUndefined();
  });

  it("rejects evaluation scores outside 0 through 100", () => {
    expect(() => resolveCareerDestination({ position: "PF", evaluationScore: -0.1, seed: 1 })).toThrow(/0 to 100/);
    expect(() => resolveCareerDestination({ position: "PF", evaluationScore: 100.1, seed: 1 })).toThrow(/0 to 100/);
    expect(() => resolveCareerDestination({ position: "PF", evaluationScore: Number.NaN, seed: 1 })).toThrow(/0 to 100/);
  });
});
