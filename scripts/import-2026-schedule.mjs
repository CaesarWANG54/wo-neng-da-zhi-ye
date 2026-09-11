import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const pdfPath = resolve(root, "tmp/pdfs/2026-27-schedule-by-date.pdf");
const outputPath = resolve(root, "src/game/schedule-2026.ts");
const expectedPdfSha256 = "5e82e37ef1b19e226dee57be69958b95b5694516280d3034aa7c1d64292b3570";

const teamIds = new Map([
  ["Atlanta", "HAWKS"],
  ["Boston", "CELTICS"],
  ["Brooklyn", "NETS"],
  ["Charlotte", "HORNETS"],
  ["Chicago", "BULLS"],
  ["Cleveland", "CAVALIERS"],
  ["Dallas", "MAVERICKS"],
  ["Denver", "NUGGETS"],
  ["Detroit", "PISTONS"],
  ["Golden State", "WARRIORS"],
  ["Houston", "ROCKETS"],
  ["Indiana", "PACERS"],
  ["LA Clippers", "CLIPPERS"],
  ["LA Lakers", "LAKERS"],
  ["Memphis", "GRIZZLIES"],
  ["Miami", "HEAT"],
  ["Milwaukee", "BUCKS"],
  ["Minnesota", "TIMBERWOLVES"],
  ["New Orleans", "PELICANS"],
  ["New York", "KNICKS"],
  ["Oklahoma City", "THUNDER"],
  ["Orlando", "MAGIC"],
  ["Philadelphia", "SIXERS"],
  ["Phoenix", "SUNS"],
  ["Portland", "TRAIL_BLAZERS"],
  ["Sacramento", "KINGS"],
  ["San Antonio", "SPURS"],
  ["Toronto", "RAPTORS"],
  ["Utah", "JAZZ"],
  ["Washington", "WIZARDS"],
]);

const teamPattern = [...teamIds.keys()]
  .sort((first, second) => second.length - first.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  .join("|");
const rowPattern = new RegExp(`^(\\d+)\\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\.\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{2})\\s+(${teamPattern})\\s+(at|vs)\\s+(${teamPattern})\\s+(\\d{1,2}:\\d{2}\\s+[AP]M)\\s+(\\d{1,2}:\\d{2}\\s+[AP]M)(?:\\s+.*)?$`, "u");

function isoDate(value) {
  const [month, day, shortYear] = value.split("/").map(Number);
  return `20${String(shortYear).padStart(2, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const pdf = await readFile(pdfPath);
const digest = createHash("sha256").update(pdf).digest("hex");
if (digest !== expectedPdfSha256) throw new Error(`Unexpected source PDF hash: ${digest}`);

const extraction = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
});
if (extraction.error) {
  throw new Error(`Unable to extract the verified schedule PDF with pdftotext: ${extraction.error.message}`);
}
if (extraction.status !== 0 || !extraction.stdout.trim()) {
  throw new Error(`pdftotext failed for the verified schedule PDF: ${extraction.stderr.trim() || `exit ${extraction.status}`}`);
}
const text = extraction.stdout;
const games = [];
for (const rawLine of text.split(/\r?\n/u)) {
  const line = rawLine.trim().replace(/\s+/gu, " ");
  const match = rowPattern.exec(line);
  if (!match) continue;
  const [, gameId, date, awayName, separator, homeName, , easternTime] = match;
  games.push({
    gameId: Number(gameId),
    date: isoDate(date),
    awayTeamId: teamIds.get(awayName),
    homeTeamId: teamIds.get(homeName),
    easternTime: easternTime.replace(" ", ""),
    neutralSite: separator === "vs",
  });
}

games.sort((first, second) => first.date.localeCompare(second.date) || first.gameId - second.gameId);
const uniqueIds = new Set(games.map((game) => game.gameId));
if (games.length !== 1200 || uniqueIds.size !== 1200) {
  throw new Error(`Expected 1200 assigned games, got ${games.length}/${uniqueIds.size}`);
}
for (let gameId = 1; gameId <= 1200; gameId += 1) {
  if (!uniqueIds.has(gameId)) throw new Error(`Missing game id ${gameId}`);
}
for (const teamId of teamIds.values()) {
  const teamGames = games.filter((game) => game.awayTeamId === teamId || game.homeTeamId === teamId);
  if (teamGames.length !== 80) throw new Error(`${teamId} has ${teamGames.length} assigned games`);
  const duplicateDates = teamGames.filter((game, index) => teamGames.findIndex((candidate) => candidate.date === game.date) !== index);
  if (duplicateDates.length > 0) throw new Error(`${teamId} has multiple games on ${duplicateDates[0].date}`);
}

const tuples = games.map((game) => `  [${game.gameId}, "${game.date}", "${game.awayTeamId}", "${game.homeTeamId}", "${game.easternTime}", ${game.neutralSite}],`).join("\n");
const source = `// Generated from the reviewed 2026-27 published regular-season schedule.\n// The release fixes 80 games per team; two Cup-derived games per team remain dynamic.\n// Provenance and the immutable input hash are recorded in docs/data/2026-27-schedule-source.md.\nexport type ScheduleGameTuple = readonly [\n  gameId: number,\n  date: string,\n  awayTeamId: string,\n  homeTeamId: string,\n  easternTime: string,\n  neutralSite: boolean,\n];\n\nexport const regularSeasonSchedule2026 = [\n${tuples}\n] as const satisfies readonly ScheduleGameTuple[];\n`;

await writeFile(outputPath, source, "utf8");
console.log(`Imported ${games.length} games from ${games[0].date} through ${games.at(-1).date}.`);
