export type JerseyNumber = number | "00";

export const JERSEY_NUMBER_OPTION_COUNT = 101;

export function isValidJerseyNumber(value: unknown): value is JerseyNumber {
  return value === "00" || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 99);
}

export function assertJerseyNumber(value: unknown): JerseyNumber {
  if (!isValidJerseyNumber(value)) throw new Error("Jersey number must be 0 through 99 or 00");
  return value;
}

export function jerseyNumberOrdinal(value: JerseyNumber) {
  return value === "00" ? 100 : value;
}

export function jerseyNumberFromOrdinal(ordinal: number): JerseyNumber {
  if (!Number.isInteger(ordinal)) throw new Error("Jersey number ordinal must be an integer");
  const normalized = ((ordinal % JERSEY_NUMBER_OPTION_COUNT) + JERSEY_NUMBER_OPTION_COUNT) % JERSEY_NUMBER_OPTION_COUNT;
  return normalized === 100 ? "00" : normalized;
}

export function stepJerseyNumber(value: JerseyNumber, direction: -1 | 1): JerseyNumber {
  return jerseyNumberFromOrdinal(jerseyNumberOrdinal(assertJerseyNumber(value)) + direction);
}
