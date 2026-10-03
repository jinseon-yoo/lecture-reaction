/**
 * REACTION_META names Font Awesome free-solid icons as strings; the React
 * component needs the icon objects. One explicit table, so an unknown name is
 * a type error rather than a blank chip.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCheck,
  faEyeSlash,
  faVolumeXmark,
  faForward,
  faHeart,
  faLightbulb,
  faQuestion,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { REACTION_META, type PaletteKey, type ReactionType } from '@lr/shared';
import againEmoji from '../assets/emoji/again.png';
import cantHearEmoji from '../assets/emoji/cant_hear.png';
import cantSeeEmoji from '../assets/emoji/cant_see.png';
import confusedEmoji from '../assets/emoji/confused.png';
import ideaEmoji from '../assets/emoji/idea.png';
import loveEmoji from '../assets/emoji/love.png';
import tooFastEmoji from '../assets/emoji/too_fast.png';
import understandEmoji from '../assets/emoji/understand.png';

const BY_NAME: Record<string, IconDefinition> = {
  check: faCheck,
  'eye-slash': faEyeSlash,
  'volume-xmark': faVolumeXmark,
  question: faQuestion,
  forward: faForward,
  heart: faHeart,
  'rotate-left': faRotateLeft,
  lightbulb: faLightbulb,
};

export function reactionIcon(type: ReactionType): IconDefinition {
  return BY_NAME[REACTION_META[type].icon] ?? faQuestion;
}

/**
 * The floating layer draws full-colour 3D emoji instead of the flat icons: on
 * top of a slide a colourful shape is recognised faster than a glyph in a
 * chip. Bundled PNGs (Fluent Emoji, see assets/emoji/LICENSE.md) rather than
 * the system font, so macOS and Windows show the same picture and the app
 * needs no network. Keyed by type, so a new reaction without art is a type
 * error.
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
