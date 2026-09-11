export interface DraftProspect2026 {
  name: string;
  selectingTeamId: string;
  tradedToTeamId?: string;
}

export interface DraftCeremonyPick {
  pick: number;
  ordinalLabel: string;
  selectingTeamId: string;
  playerName: string;
  isCreatedPlayer: boolean;
  tradedToTeamId?: string;
}

/** Published first-round order and prospect names, reviewed 2026-09-02. */
export const draftProspects2026: readonly DraftProspect2026[] = [
  { name: "AJ Dybantsa", selectingTeamId: "WIZARDS" },
  { name: "Darryn Peterson", selectingTeamId: "JAZZ" },
  { name: "Cameron Boozer", selectingTeamId: "GRIZZLIES" },
  { name: "Caleb Wilson", selectingTeamId: "BULLS" },
  { name: "Keaton Wagler", selectingTeamId: "CLIPPERS" },
  { name: "Mikel Brown Jr.", selectingTeamId: "NETS" },
  { name: "Darius Acuff Jr.", selectingTeamId: "KINGS" },
  { name: "Kingston Flemings", selectingTeamId: "HAWKS" },
  { name: "Morez Johnson Jr.", selectingTeamId: "MAVERICKS" },
  { name: "Brayden Burries", selectingTeamId: "BUCKS" },
  { name: "Yaxel Lendeborg", selectingTeamId: "WARRIORS" },
  { name: "Aday Mara", selectingTeamId: "THUNDER" },
  { name: "Nate Ament", selectingTeamId: "HEAT", tradedToTeamId: "BUCKS" },
  { name: "Hannes Steinbach", selectingTeamId: "HORNETS" },
  { name: "Dailyn Swain", selectingTeamId: "BULLS" },
  { name: "Bennett Stirtz", selectingTeamId: "GRIZZLIES", tradedToTeamId: "THUNDER" },
  { name: "Ebuka Okorie", selectingTeamId: "THUNDER", tradedToTeamId: "PISTONS" },
  { name: "Christian Anderson", selectingTeamId: "HORNETS" },
  { name: "Allen Graves", selectingTeamId: "RAPTORS" },
  { name: "Jayden Quaintance", selectingTeamId: "SPURS" },
  { name: "Karim López", selectingTeamId: "PISTONS", tradedToTeamId: "GRIZZLIES" },
  { name: "Labaron Philon Jr.", selectingTeamId: "SIXERS" },
  { name: "Zuby Ejiofor", selectingTeamId: "HAWKS" },
  { name: "Cameron Carr", selectingTeamId: "KNICKS", tradedToTeamId: "LAKERS" },
  { name: "Sergio De Larrea", selectingTeamId: "LAKERS", tradedToTeamId: "MAVERICKS" },
  { name: "Tarris Reed Jr.", selectingTeamId: "NUGGETS", tradedToTeamId: "SPURS" },
  { name: "Chris Cenac Jr.", selectingTeamId: "CELTICS" },
  { name: "Joshua Jefferson", selectingTeamId: "TIMBERWOLVES", tradedToTeamId: "NETS" },
  { name: "Alex Karaban", selectingTeamId: "CAVALIERS", tradedToTeamId: "KINGS" },
  { name: "Koa Peat", selectingTeamId: "MAVERICKS", tradedToTeamId: "SUNS" },
] as const;

export const draftPickTeamIds2026 = draftProspects2026.map((entry) => entry.selectingTeamId);

export function draftOrdinalLabel(pick: number) {
  if (!Number.isInteger(pick) || pick < 1 || pick > 30) throw new Error("Draft pick must be from 1 to 30");
  if (pick === 1) return "First pick";
  if (pick === 2) return "Second pick";
  if (pick === 3) return "Third pick";
  const lastTwo = pick % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : pick % 10 === 1 ? "st" : pick % 10 === 2 ? "nd" : pick % 10 === 3 ? "rd" : "th";
  return `${pick}${suffix} pick`;
}

/** The untouched first round used when the created player is not selected. */
export function buildUndraftedCeremony(): readonly DraftCeremonyPick[] {
  return draftProspects2026.map((prospect, index) => ({
    pick: index + 1,
    ordinalLabel: draftOrdinalLabel(index + 1),
    selectingTeamId: prospect.selectingTeamId,
    playerName: prospect.name,
    isCreatedPlayer: false,
    tradedToTeamId: prospect.tradedToTeamId,
  }));
}

/** Inserts the created player at their awarded slot and shifts the remaining board down. */
export function buildDraftCeremony(createdPlayerName: string, createdPlayerPick: number): readonly DraftCeremonyPick[] {
  if (!Number.isInteger(createdPlayerPick) || createdPlayerPick < 1 || createdPlayerPick > 30) {
    throw new Error("Created player pick must be from 1 to 30");
  }
  const name = createdPlayerName.trim();
  if (!name) throw new Error("Created player name is required");
  const shiftedNames = draftProspects2026.map((prospect) => prospect.name);
  shiftedNames.splice(createdPlayerPick - 1, 0, name);
  return draftProspects2026.map((slot, index) => {
    const isCreatedPlayer = index === createdPlayerPick - 1;
    const shiftedProspect = isCreatedPlayer ? undefined : draftProspects2026[index < createdPlayerPick ? index : index - 1];
    return {
      pick: index + 1,
      ordinalLabel: draftOrdinalLabel(index + 1),
      selectingTeamId: slot.selectingTeamId,
      playerName: shiftedNames[index],
      isCreatedPlayer,
      tradedToTeamId: isCreatedPlayer ? undefined : shiftedProspect?.tradedToTeamId,
    };
  });
}
