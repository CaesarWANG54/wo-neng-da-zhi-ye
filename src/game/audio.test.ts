import { describe, expect, it } from "vitest";
import { AUDIO_ASSET_PATHS, isSwishEventKind, shouldPlayCourtAmbience } from "./audio";
import type { PossessionPhase } from "./types";

describe("court audio policy", () => {
  it("plays ambience only during live basketball phases", () => {
    const live: PossessionPhase[] = ["SET_OFFENSE", "SCREEN_APPROACH", "SECOND_DECISION", "SHOT_FLIGHT", "REBOUND", "FASTBREAK", "BACKCOURT_ADVANCE"];
    const stopped: PossessionPhase[] = ["DEAD_BALL", "INBOUND_READY", "FREE_THROW", "PERIOD_END", "TIP_OFF", "FINAL"];
    for (const phase of live) expect(shouldPlayCourtAmbience({ phase, paused: false, hidden: false, volume: 70 })).toBe(true);
    for (const phase of stopped) expect(shouldPlayCourtAmbience({ phase, paused: false, hidden: false, volume: 70 })).toBe(false);
  });

  it("stops for pause, backgrounding and mute", () => {
    expect(shouldPlayCourtAmbience({ phase: "SET_OFFENSE", paused: true, hidden: false, volume: 70 })).toBe(false);
    expect(shouldPlayCourtAmbience({ phase: "SET_OFFENSE", paused: false, hidden: true, volume: 70 })).toBe(false);
    expect(shouldPlayCourtAmbience({ phase: "SET_OFFENSE", paused: false, hidden: false, volume: 0 })).toBe(false);
  });

  it("uses a swish only for real makes, including made free throws", () => {
    expect(isSwishEventKind("MADE_BASKET")).toBe(true);
    expect(isSwishEventKind("SHOT_MADE_AT_HORN")).toBe(true);
    expect(isSwishEventKind("SHOT_MADE_AND_FOUL")).toBe(true);
    expect(isSwishEventKind("FREE_THROW_MADE")).toBe(true);
    expect(isSwishEventKind("MADE_BASKET", "FREE_THROW_MADE")).toBe(false);
    expect(isSwishEventKind("GOALTENDING")).toBe(false);
    expect(isSwishEventKind("FREE_THROW_MISSED")).toBe(false);
  });

  it("keeps only the approved dribble and swish media, both same-origin", () => {
    expect(AUDIO_ASSET_PATHS).toEqual({
      dribble: "/assets/audio/court-dribble.mp3",
      swish: "/assets/audio/basket-swish.mp3",
    });
    expect(Object.values(AUDIO_ASSET_PATHS).every((path) => path.startsWith("/assets/audio/") && !path.includes("://"))).toBe(true);
  });
});
