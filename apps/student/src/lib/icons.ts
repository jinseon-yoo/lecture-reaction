import type { PaletteKey, ReactionType } from '@lr/shared';
import againEmoji from '@lr/shared/emoji/again.png';
import cantHearEmoji from '@lr/shared/emoji/cant_hear.png';
import cantSeeEmoji from '@lr/shared/emoji/cant_see.png';
import confusedEmoji from '@lr/shared/emoji/confused.png';
import ideaEmoji from '@lr/shared/emoji/idea.png';
import loveEmoji from '@lr/shared/emoji/love.png';
import tooFastEmoji from '@lr/shared/emoji/too_fast.png';
import understandEmoji from '@lr/shared/emoji/understand.png';

/**
 * The same 3D emoji the overlay floats over the slides, so what a student
 * taps is what the professor sees. Keyed by type, so a new reaction without
 * art is a type error.
 */
const EMOJI: Record<ReactionType, string> = {
  understand: understandEmoji,
  confused: confusedEmoji,
  too_fast: tooFastEmoji,
  love: loveEmoji,
  again: againEmoji,
  idea: ideaEmoji,
  cant_see: cantSeeEmoji,
  cant_hear: cantHearEmoji,
};

export function reactionEmoji(type: ReactionType): string {
  return EMOJI[type];
}

/** theme.css accent classes, listed literally so they survive any purge pass. */
const ACCENT_CLASS: Record<PaletteKey, string> = {
  sky: 'lr-a-sky',
  pink: 'lr-a-pink',
  lavender: 'lr-a-lavender',
  mint: 'lr-a-mint',
  yellow: 'lr-a-yellow',
  peach: 'lr-a-peach',
  sage: 'lr-a-sage',
  aqua: 'lr-a-aqua',
};

export function accentClass(accent: PaletteKey): string {
  return ACCENT_CLASS[accent];
}
