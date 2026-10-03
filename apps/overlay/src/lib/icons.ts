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
 * Reactions are drawn as full-colour 3D emoji, the same picture on the
 * student's button and floating over the slide, so the room and the lectern
 * share one vocabulary. Bundled PNGs (Fluent Emoji, see
 * packages/shared/assets/emoji/LICENSE.md) rather than the system font, so
 * macOS and Windows show the same picture and the app needs no network.
 * Keyed by type, so a new reaction without art is a type error.
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

export const ACCENT_VAR: Record<PaletteKey, string> = {
  sky: 'var(--lr-sky)',
  pink: 'var(--lr-pink)',
  lavender: 'var(--lr-lavender)',
  mint: 'var(--lr-mint)',
  yellow: 'var(--lr-yellow)',
  peach: 'var(--lr-peach)',
  sage: 'var(--lr-sage)',
  aqua: 'var(--lr-aqua)',
};
