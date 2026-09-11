import {
  getCareerSeasonBounds,
  simulateCareerToDate,
  type CareerSeasonBounds,
  type CareerSimulationOptions,
  type CareerSeasonState,
} from "./career-season";
import {
  completeTrainingWeek,
  effectiveRatings,
  type CareerProgressionState,
} from "./career-progression";

const DAY_MS = 24 * 60 * 60 * 1_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string) {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid career date: ${value}`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid career date: ${value}`);
  }
  return timestamp;
}

function formatIsoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function careerWeekForDate(date: string, season: number | CareerSeasonBounds = 1) {
  const bounds = getCareerSeasonBounds(season);
  const seasonStartTimestamp = parseIsoDate(bounds.startDate);
  const seasonEndTimestamp = parseIsoDate(bounds.endDate);
  const timestamp = parseIsoDate(date);
  if (timestamp < seasonStartTimestamp || timestamp > seasonEndTimestamp) {
    throw new Error(`Career date is outside the active season: ${date}`);
  }
  return Math.floor((timestamp - seasonStartTimestamp) / (7 * DAY_MS)) + 1;
}

/**
 * Settles every complete training week crossed by calendar simulation.
 *
 * Season one begins on Monday 2026-10-19. Every later projected season keeps the
 * same seven-day blocks anchored to its descriptor start date. Staying inside a
 * block keeps the current two-session allowance; crossing its boundary settles
 * the prior week exactly once and resets the allowance. Week IDs are
 * deterministic, so a retried save command cannot apply inactivity twice.
 */
export function advanceCareerProgressionToDate(
  state: CareerProgressionState,
  currentDate: string,
  targetDate: string,
  season: number | CareerSeasonBounds = state.season,
) {
  const bounds = getCareerSeasonBounds(season);
  const currentTimestamp = parseIsoDate(currentDate);
  const targetTimestamp = parseIsoDate(targetDate);
  if (targetTimestamp < currentTimestamp) throw new Error("Cannot advance career progression backwards");

  const currentWeek = careerWeekForDate(currentDate, bounds);
  const targetWeek = careerWeekForDate(targetDate, bounds);
  if (state.week !== currentWeek) {
    throw new Error(`Career progression week ${state.week} is out of sync with calendar week ${currentWeek}`);
  }

  let next = state;
  while (next.week < targetWeek) {
    next = completeTrainingWeek(next, {
      weekId: `season-${next.season}-week-${next.week}`,
      expectedWeek: next.week,
    });
  }
  return next;
}

export interface CareerCalendarAdvanceResult {
  season: CareerSeasonState;
  progression: CareerProgressionState;
}

/**
 * Advances the calendar chronologically instead of applying the target day's
 * final ratings retroactively to every skipped game. Each completed seven-day
 * block is simulated with that week's ratings, training/inactivity settles at
 * the boundary, and games in the new block use the newly effective ratings.
 */
export function advanceCareerCalendar(
  season: CareerSeasonState,
  progression: CareerProgressionState,
  targetDate: string,
  options: CareerSimulationOptions = {},
): CareerCalendarAdvanceResult {
  const bounds = getCareerSeasonBounds(season);
  if (progression.season !== season.seasonNumber) {
    throw new Error(`Career progression season ${progression.season} is out of sync with calendar season ${season.seasonNumber}`);
  }
  const seasonStartTimestamp = parseIsoDate(bounds.startDate);
  const currentTimestamp = parseIsoDate(season.currentDate);
  const targetTimestamp = parseIsoDate(targetDate);
  if (targetTimestamp < currentTimestamp) throw new Error("Cannot simulate backwards");
  careerWeekForDate(targetDate, bounds);
  if (progression.week !== careerWeekForDate(season.currentDate, bounds)) {
    throw new Error("Career season and progression weeks are out of sync");
  }

  let nextSeason = season;
  let nextProgression = progression;
  while (true) {
    const nextMondayTimestamp = seasonStartTimestamp + nextProgression.week * 7 * DAY_MS;
    if (nextMondayTimestamp > targetTimestamp) break;
    const sundayDate = formatIsoDate(nextMondayTimestamp - DAY_MS);
    const mondayDate = formatIsoDate(nextMondayTimestamp);

    if (nextSeason.currentDate < sundayDate) {
      nextSeason = simulateCareerToDate(
        nextSeason,
        sundayDate,
        effectiveRatings(nextProgression.ratings, nextProgression.chemistryPercent),
        options,
      );
    }
    nextProgression = advanceCareerProgressionToDate(nextProgression, sundayDate, mondayDate, bounds);
    nextSeason = simulateCareerToDate(
      nextSeason,
      mondayDate,
      effectiveRatings(nextProgression.ratings, nextProgression.chemistryPercent),
      options,
    );
  }

  if (nextSeason.currentDate < targetDate) {
    nextSeason = simulateCareerToDate(
      nextSeason,
      targetDate,
      effectiveRatings(nextProgression.ratings, nextProgression.chemistryPercent),
      options,
    );
  }
  return { season: nextSeason, progression: nextProgression };
}
