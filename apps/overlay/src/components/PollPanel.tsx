import type { CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark,
  faMinus,
  faUpRightAndDownLeftFromCenter,
  faDownLeftAndUpRightToCenter,
} from '@fortawesome/free-solid-svg-icons';
import { UNDERSTANDING_OPTIONS, type PaletteKey, type PollResultsView } from '@lr/shared';
import { ACCENT_VAR } from '../lib/icons';

/** Understanding always reads mint → yellow → pink, best to worst. */
const UNDERSTANDING_ACCENT: Record<string, PaletteKey> = {
  got_it: 'mint',
  almost: 'yellow',
  lost: 'pink',
};

const CUSTOM_ACCENTS: PaletteKey[] = ['sky', 'lavender', 'mint', 'yellow'];

interface Row {
  id: string;
  label: string;
  pct: number;
  accent: PaletteKey;
}

function rowsFor(results: PollResultsView): Row[] {
  const byId = new Map(results.results.map((r) => [r.optionId, r]));

  if (results.kind === 'understanding') {
    // Always show all three, in a fixed order, even before anyone answers —
    // a jumping row order is unreadable mid-sentence.
    return UNDERSTANDING_OPTIONS.map((opt) => ({
      id: opt.id,
      label: opt.label,
      pct: byId.get(opt.id)?.pct ?? 0,
      accent: UNDERSTANDING_ACCENT[opt.id] ?? 'sky',
    }));
  }

  return results.results.map((r, i) => ({
    id: r.optionId,
    label: r.label,
    pct: r.pct,
    accent: CUSTOM_ACCENTS[i % CUSTOM_ACCENTS.length],
  }));
}

/**
 * Results panel. Bars animate their width — the nodes are never remounted — so
 * incoming answers glide instead of flickering.
 *
 * Two sizes, same component and same DOM nodes, so expanding never restarts a
 * bar animation mid-poll:
 *  - corner: the compact panel the professor reads while talking;
 *  - presented: popped out to the middle of the screen at projector size, for
 *    when the whole room should read the result off the wall.
 */
export function PollPanel({
  results,
  onMinimize,
  onClose,
  onTogglePresent,
  presenting = false,
  raised = false,
}: {
  results: PollResultsView;
  onMinimize: () => void;
  onClose: () => void;
  /** Swaps between the corner panel and the centred, projector-sized one. */
  onTogglePresent: () => void;
  presenting?: boolean;
  /**
   * The control strip's popovers open upward from the same bottom-left corner.
   * When one is open the panel lifts clear of it instead of being half-covered.
   */
  raised?: boolean;
}) {
  const rows = rowsFor(results);
  const title = results.kind === 'understanding' ? 'UNDERSTANDING' : results.question;

  // Everything that differs between the two sizes, kept in one place so the
  // markup below stays a single tree.
  const size = presenting
    ? {
        // Presenting is the one case that *should* be centred: the results are
        // being shown to the room, not kept out of the professor's way.
        frame: 'left-1/2 top-1/2 w-[min(78vw,880px)] -translate-x-1/2 -translate-y-1/2 px-8 py-6 z-40',
        title: 'text-[20px] tracking-[0.14em]',
        button: 'p-2! text-[16px]!',
        list: 'mt-5 gap-4',
        label: 'text-[22px] w-[150px]',
        pct: 'text-[22px] w-[74px]',
        track: 'lr-bar-track-lg',
        total: 'text-[14px] mt-4',
      }
    : {
        // Position and width come from the overlay's screen-derived tokens
        // (see `.lr-poll-compact` in index.css); only the vertical clearance
        // over the control strip is decided here.
        frame: `lr-poll-compact px-3 py-2 ${raised ? 'bottom-[19rem]' : 'bottom-24'}`,
        title: 'text-[10px] tracking-[0.12em]',
        button: 'p-1! text-[10px]!',
        list: 'mt-2 gap-1.5',
        label: 'text-[11px] w-[54px]',
        pct: 'text-[11px] w-[34px]',
        track: '',
        total: 'text-[10px] mt-2',
      };

  return (
    <section
      data-lr-interactive="true"
      className={`lr-panel-glass lr-interactive fixed ${size.frame}`}
      aria-label="Poll results"
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className={`lr-pixel uppercase pr-2 ${size.title}`}>{title}</h2>
        <div className="flex gap-1">
          <button
            type="button"
            data-lr-interactive="true"
            className={`lr-btn lr-btn-ghost lr-interactive ${size.button}`}
            aria-label={presenting ? 'Shrink results back to the corner' : 'Show results big, in the middle of the screen'}
            title={presenting ? 'Back to the corner' : 'Show to the class'}
            onClick={onTogglePresent}
          >
            <FontAwesomeIcon
              icon={presenting ? faDownLeftAndUpRightToCenter : faUpRightAndDownLeftFromCenter}
            />
          </button>
          {!presenting && (
            <button
              type="button"
              data-lr-interactive="true"
              className={`lr-btn lr-btn-ghost lr-interactive ${size.button}`}
              aria-label="Minimize results"
              onClick={onMinimize}
            >
              <FontAwesomeIcon icon={faMinus} />
            </button>
          )}
          <button
            type="button"
            data-lr-interactive="true"
            className={`lr-btn lr-btn-ghost lr-interactive ${size.button}`}
            aria-label="End poll"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </header>

      <ul className={`flex flex-col ${size.list}`}>
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className={`lr-text shrink-0 ${size.label}`}>{row.label}</span>
            <span className={`lr-pixel shrink-0 text-right ${size.pct}`}>{row.pct}%</span>
            <span className={`lr-bar-track grow ${size.track}`}>
              <span
                className="lr-bar-fill block"
                style={
                  {
                    width: `${Math.max(0, Math.min(100, row.pct))}%`,
                    '--lr-bar-accent': ACCENT_VAR[row.accent],
                  } as CSSProperties
                }
              />
            </span>
          </li>
        ))}
      </ul>

      <p className={`lr-pixel text-(--lr-muted) ${size.total}`}>(n={results.total})</p>
    </section>
  );
}
