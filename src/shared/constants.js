/**
 * Shared constants used across main and renderer processes.
 */

/**
 * Sentinel value used to represent "blank" media (media with no observations).
 * Uses a UUID-like format to minimize collision risk with actual species names.
 * This value is used in species filtering to request blank media counts.
 */
export const BLANK_SENTINEL = '__blank__f47ac10b-58cc-4372-a567-0e02b2c3d479__'

/**
 * Sentinel value used to represent vehicle observations as a pseudo-species.
 * Vehicle observations always have empty `scientificName` per the Camtrap DP
 * convention; this sentinel lets the UI's species-filter pipeline treat
 * Vehicle as a single filterable bucket alongside Blank.
 */
export const VEHICLE_SENTINEL = '__vehicle__a8c3e9b2-7d4f-4e1a-9b2c-3d4e5f6a7b8c__'

/**
 * Default sequence gap in seconds.
 * Used when no user preference is set.
 */
export const DEFAULT_SEQUENCE_GAP = 120

/**
 * Behavior categories for the UI.
 * Groups behaviors by type for better organization in dropdown menus.
 * Values must match those in suggestedBehaviorValues from validators.js
 */
export const behaviorCategories = /** @type {const} */ ({
  Movement: ['running', 'walking', 'standing', 'resting', 'alert', 'vigilance'],
  'Feeding (Herbivore)': ['grazing', 'browsing', 'rooting', 'foraging'],
  'Feeding (Predator)': ['hunting', 'stalking', 'chasing', 'feeding', 'carrying prey'],
  Social: ['grooming', 'playing', 'fighting', 'mating', 'nursing'],
  Other: ['drinking', 'scent-marking', 'digging']
})
