import { describe, expect, it } from "vitest";
import { buildDraftCeremony, buildUndraftedCeremony, draftOrdinalLabel, draftPickTeamIds2026, draftProspects2026 } from "./draft-2026";

describe("2026 first-round ceremony", () => {
  it("keeps all 30 published slots and English prospect names in order", () => {
    expect(draftProspects2026).toHaveLength(30);
    expect(draftPickTeamIds2026).toHaveLength(30);
    expect(draftProspects2026.slice(0, 3)).toEqual([
      { name: "AJ Dybantsa", selectingTeamId: "WIZARDS" },
      { name: "Darryn Peterson", selectingTeamId: "JAZZ" },
      { name: "Cameron Boozer", selectingTeamId: "GRIZZLIES" },
    ]);
    expect(draftProspects2026.at(-1)?.name).toBe("Koa Peat");
  });

  it("makes a third-pick player watch the first two selections", () => {
    const board = buildDraftCeremony("林远", 3);
    expect(board).toHaveLength(30);
    expect(board.slice(0, 4).map((entry) => [entry.ordinalLabel, entry.playerName, entry.selectingTeamId])).toEqual([
      ["First pick", "AJ Dybantsa", "WIZARDS"],
      ["Second pick", "Darryn Peterson", "JAZZ"],
      ["Third pick", "林远", "GRIZZLIES"],
      ["4th pick", "Cameron Boozer", "BULLS"],
    ]);
  });

  it("shifts every published prospect down when the player is selected first", () => {
    const board = buildDraftCeremony("状元新秀", 1);
    expect(board[0]).toMatchObject({ playerName: "状元新秀", selectingTeamId: "WIZARDS", isCreatedPlayer: true });
    expect(board[1]).toMatchObject({ playerName: "AJ Dybantsa", selectingTeamId: "JAZZ", isCreatedPlayer: false });
    expect(board[29].playerName).toBe("Alex Karaban");
    expect(board.some((entry) => entry.playerName === "Koa Peat")).toBe(false);
  });

  it("keeps all 30 original selections untouched when the created player goes undrafted", () => {
    const board = buildUndraftedCeremony();
    expect(board).toHaveLength(30);
    expect(board.map((entry) => entry.playerName)).toEqual(draftProspects2026.map((entry) => entry.name));
    expect(board.map((entry) => entry.selectingTeamId)).toEqual(draftPickTeamIds2026);
    expect(board.every((entry) => entry.isCreatedPlayer === false)).toBe(true);
    expect(board.at(-1)).toMatchObject({ pick: 30, playerName: "Koa Peat", selectingTeamId: "MAVERICKS" });
  });

  it("formats the requested first three labels and rejects invalid picks", () => {
    expect([1, 2, 3, 4, 11, 22].map(draftOrdinalLabel)).toEqual(["First pick", "Second pick", "Third pick", "4th pick", "11th pick", "22nd pick"]);
    expect(() => buildDraftCeremony("林远", 0)).toThrow(/1 to 30/);
  });
});
