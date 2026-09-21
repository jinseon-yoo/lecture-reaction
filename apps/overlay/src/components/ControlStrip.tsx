import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartSimple,
  faEye,
  faEyeSlash,
  faGear,
  faLink,
  faQrcode,
  faCheck,
  faQuestion,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons';
import type { ConnectionState } from '../lib/socket';
import type { OverlaySettings } from '../lib/settings';
import { REACTION_META, type ReactionType, type ReactionZone } from '@lr/shared';
import { clamp } from '../lib/spawn';
import { reactionIcon } from '../lib/icons';
import { readJson, STORAGE_KEYS, writeJson } from '../lib/storage';
import { PollComposer } from './PollComposer';
import { Popup } from './Popup';
import { QrCanvas } from './QrCanvas';

type Popover = 'none' | 'settings' | 'end' | 'composer' | 'qr';

interface Point {
  x: number;
  y: number;
}

/** Only a fallback for measuring before the strip has laid out once. */
const STRIP_SIZE = { width: 420, height: 44 };
const LONG_PRESS_MS = 450;

type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/**
 * Where the strip sits, stored as a **corner plus an inset** rather than as a
 * screen coordinate.
 *
 * Absolute pixels were the bug. `{x: 24, y: 832}` is the bottom-left corner of
 * a 900px-tall laptop screen and the middle of a 1080p projector, so a strip
 * placed once in the office drifted into the slides the moment the machine met
 * a different display — the one place the overlay must never be. Clamping it
 * back into the viewport did not help: clamping keeps a panel on screen, it
 * does not keep it in a corner.
 *
 * An anchor survives the change by construction. Bottom-left is bottom-left on
 * a 1280x800 laptop, a 1920x1080 projector and a 4K panel, with no arithmetic
 * that can round its way into the middle of the slide.
 */
interface Dock {
  corner: Corner;
  /** Extra px beyond the edge inset, so a dragged strip lands where it was dropped. */
  dx: number;
  dy: number;
}

/** Bottom-left by default: the question stack owns the right edge. */
const DEFAULT_DOCK: Dock = { corner: 'bottom-left', dx: 0, dy: 0 };

/**
 * Mirrors `--lr-edge` in index.css — `clamp(12px, 1.4vw, 32px)`.
 *
 * Custom properties are not resolved by `getComputedStyle` unless registered,
 * so the value is recomputed here rather than read back. Keep the two in step.
 */
function edgeInset(): number {
  return Math.round(Math.min(32, Math.max(12, window.innerWidth * 0.014)));
}

/** Reads whatever is in storage, including the pre-anchor `{x, y}` shape. */
function loadDock(): Dock {
  const saved = readJson<Partial<Dock> & Partial<Point>>(
    STORAGE_KEYS.stripPosition,
    DEFAULT_DOCK,
  );
  if (typeof saved.corner === 'string') {
    return {
      corner: saved.corner,
      dx: Number.isFinite(saved.dx) ? (saved.dx as number) : 0,
      dy: Number.isFinite(saved.dy) ? (saved.dy as number) : 0,
    };
  }
  // A position saved by an older build. It was chosen on some other screen and
  // there is no way to tell which, so the corner it was nearest is the best
  // available guess — and the default corner if it was nowhere near one.
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    return { ...nearestCorner(saved.x, saved.y, STRIP_SIZE.width, STRIP_SIZE.height), dx: 0, dy: 0 };
  }
  return DEFAULT_DOCK;
}

/** The corner a strip at `(x, y)` is closest to, by its own centre. */
function nearestCorner(x: number, y: number, w: number, h: number): { corner: Corner } {
  const vertical = y + h / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
  const horizontal = x + w / 2 < window.innerWidth / 2 ? 'left' : 'right';
  return { corner: `${vertical}-${horizontal}` as Corner };
}

export interface ControlStripProps {
  code: string | null;
  connection: ConnectionState;
  settings: OverlaySettings;
  onSettingsChange: (next: OverlaySettings) => void;
  /** Reactions received but not drawn, shown while Quiet Mode is on. */
  hiddenReactionCount: number;
  onAskClass: () => void;
  onCustomPoll: (question: string, options: string[]) => void;
  /** A poll is running but its panel is minimized. */
  pollMinimized: boolean;
  onExpandPoll: () => void;
  onEndClass: () => void;
  /** Full join URL (address + code) for the share controls. */
  shareUrl: string | null;
  /**
   * A reaction that just surged past the attention threshold, or null. Drives
   * a brief highlight so the professor catches it without watching the screen.
   */
  surge: ReactionType | null;
  /** Lets the overlay lift the poll panel clear of an open popover. */
  onPopoverToggle?: (open: boolean) => void;
}

/**
 * The professor's entire control surface: a draggable, collapsible strip.
 * Everything here is `data-lr-interactive`, which is what tells the
 * click-through hit-test to let the cursor land on the window.
 */
export function ControlStrip(props: ControlStripProps) {
  const { code, connection, settings, onSettingsChange } = props;

  const [dock, setDock] = useState<Dock>(loadDock);
  /** Free screen coordinates while a drag is in flight; null the rest of the time. */
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [collapsed, setCollapsed] = useState(() =>
    readJson<boolean>(STORAGE_KEYS.stripCollapsed, false),
  );
  const [popover, setPopover] = useState<Popover>('none');

  // The poll panel shares this corner; tell the overlay to lift it clear.
  const { onPopoverToggle } = props;
  useEffect(() => {
    onPopoverToggle?.(popover !== 'none');
  }, [popover, onPopoverToggle]);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Point | null>(null);
  const longPress = useRef<number | undefined>(undefined);

  /* ---------------- dragging ---------------- */

  const clampToViewport = useCallback((p: Point): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const w = rect?.width ?? STRIP_SIZE.width;
    const h = rect?.height ?? STRIP_SIZE.height;
    return {
      x: clamp(p.x, 8, window.innerWidth - w - 8),
      y: clamp(p.y, 8, window.innerHeight - h - 8),
    };
  }, []);

  useEffect(() => {
    // A resize needs no correction to the anchor itself — that is the whole
    // point of storing a corner. It can still leave a *dragged* offset pushing
    // the strip off the new screen, so only the offset is trimmed, and the
    // corner the professor chose is never silently changed underneath them.
    const onResize = () =>
      setDock((d) => {
        const rect = rootRef.current?.getBoundingClientRect();
        const w = rect?.width ?? STRIP_SIZE.width;
        const h = rect?.height ?? STRIP_SIZE.height;
        const edge = edgeInset();
        const maxDx = Math.max(0, window.innerWidth - w - edge * 2);
        const maxDy = Math.max(0, window.innerHeight - h - edge * 2);
        if (d.dx <= maxDx && d.dy <= maxDy) return d;
        return { ...d, dx: Math.min(d.dx, maxDx), dy: Math.min(d.dy, maxDy) };
      });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Grab the strip itself — never a control inside it.
    if ((event.target as HTMLElement).closest('button, input, label')) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    // Free movement while the pointer is down; it is snapped to a corner on drop.
    setDragPos(clampToViewport({ x: event.clientX - offset.x, y: event.clientY - offset.y }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    rootRef.current?.releasePointerCapture(event.pointerId);

    const dropped = dragPos;
    setDragPos(null);
    if (!dropped) return;

    // Convert where it was dropped into an anchor, so the next screen the
    // machine meets puts it back in the same corner rather than the same
    // coordinate. Insets are measured from the two edges of that corner.
    const rect = rootRef.current?.getBoundingClientRect();
    const w = rect?.width ?? STRIP_SIZE.width;
    const h = rect?.height ?? STRIP_SIZE.height;
    const { corner } = nearestCorner(dropped.x, dropped.y, w, h);
    const edge = edgeInset();
    const fromLeft = dropped.x;
    const fromTop = dropped.y;
    const next: Dock = {
      corner,
      dx: Math.max(0, Math.round((corner.endsWith('left') ? fromLeft : window.innerWidth - fromLeft - w) - edge)),
      dy: Math.max(0, Math.round((corner.startsWith('top') ? fromTop : window.innerHeight - fromTop - h) - edge)),
    };
    setDock(next);
    writeJson(STORAGE_KEYS.stripPosition, next);
  };

  /* ---------------- collapse ---------------- */

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeJson(STORAGE_KEYS.stripCollapsed, !prev);
      if (!prev) setPopover('none');
      return !prev;
    });
  };

  /* ---------------- ask class ---------------- */

  // Plain click = instant understanding check. Alt-click or long-press opens
  // the tiny custom-poll composer. There is deliberately no configuration step
  // on the common path.
  const askDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    longPress.current = window.setTimeout(() => {
      longPress.current = undefined;
      setPopover('composer');
    }, LONG_PRESS_MS);
  };

  const askUp = () => {
    if (longPress.current === undefined) return; // long-press already fired
    window.clearTimeout(longPress.current);
    longPress.current = undefined;
  };

  const askClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (popover === 'composer') return;
    if (event.altKey) {
      setPopover('composer');
      return;
    }
    setPopover('none');
    props.onAskClass();
  };

  useEffect(() => () => window.clearTimeout(longPress.current), []);

  const reconnecting = connection === 'reconnecting' || connection === 'connecting';

  return (
    <div
      ref={rootRef}
      data-lr-interactive="true"
      // Wraps rather than running off the edge: the strip is a row of controls
      // whose width depends on the class code and the reaction set, and a
      // narrow screen must fold it instead of pushing half of it off-screen.
      className={`lr-panel-glass lr-interactive fixed z-40 flex flex-wrap items-center gap-2 px-2 py-1.5 max-w-[min(92vw,760px)] cursor-grab active:cursor-grabbing ${
        props.surge ? 'lr-surge' : ''
      }`}
      style={
        dragPos
          ? { left: dragPos.x, top: dragPos.y }
          : {
              // `calc` off the shared edge token, so the strip keeps the same
              // visual margin as every other panel on whatever screen it lands on.
              left: dock.corner.endsWith('left') ? `calc(var(--lr-edge) + ${dock.dx}px)` : undefined,
              right: dock.corner.endsWith('right') ? `calc(var(--lr-edge) + ${dock.dx}px)` : undefined,
              top: dock.corner.startsWith('top') ? `calc(var(--lr-edge) + ${dock.dy}px)` : undefined,
              bottom: dock.corner.startsWith('bottom')
                ? `calc(var(--lr-edge) + ${dock.dy}px)`
                : undefined,
            }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        data-lr-interactive="true"
        className="lr-btn lr-interactive px-2! py-1.5! text-[12px]!"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand controls' : 'Collapse controls'}
      >
        [ <span className="lr-mono tracking-[0.12em]">{code ?? '·····'}</span> ]
      </button>

      {!collapsed && (
        <>
          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onPointerDown={askDown}
            onPointerUp={askUp}
            onPointerLeave={askUp}
            onClick={askClick}
            title="Ask the class (alt-click or hold for a custom poll)"
          >
            <FontAwesomeIcon icon={faQuestion} className="mr-1.5" />
            Ask Class
          </button>

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() =>
              onSettingsChange({ ...settings, quiet: !settings.quiet })
            }
            title={settings.quiet ? 'Show reactions' : 'Hide reactions (Quiet Mode)'}
          >
            <FontAwesomeIcon icon={settings.quiet ? faEyeSlash : faEye} className="mr-1.5" />
            Reactions
          </button>

          {settings.quiet && (
            <span className="lr-pixel text-[10px] text-(--lr-muted) whitespace-nowrap">
              reactions hidden · {props.hiddenReactionCount}
            </span>
          )}

          {props.pollMinimized && (
            <button
              type="button"
              data-lr-interactive="true"
              className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
              onClick={props.onExpandPoll}
              title="Show poll results"
            >
              <FontAwesomeIcon icon={faChartSimple} />
            </button>
          )}

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() => setPopover((p) => (p === 'settings' ? 'none' : 'settings'))}
            aria-label="Overlay settings"
          >
            <FontAwesomeIcon icon={faGear} />
          </button>

          <button
            type="button"
            data-lr-interactive="true"
            className="lr-btn lr-btn-danger lr-interactive px-2! py-1.5! text-[11px]!"
            onClick={() => setPopover((p) => (p === 'end' ? 'none' : 'end'))}
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="mr-1.5" />
            End Class
          </button>

          {props.surge && (
            <span
              className="lr-pixel flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border-2 border-(--lr-dark) px-1.5 py-1 text-[10px]"
              style={{ background: `var(--lr-${REACTION_META[props.surge].accent})` }}
              role="status"
            >
              <FontAwesomeIcon icon={reactionIcon(props.surge)} />
              {REACTION_META[props.surge].label}
            </span>
          )}

          <ConnectionDot reconnecting={reconnecting} />
        </>
      )}

      {popover === 'settings' && (
        <SettingsPopover
          settings={settings}
          onChange={onSettingsChange}
          shareUrl={props.shareUrl}
          onShowQr={() => setPopover('qr')}
        />
      )}

      {popover === 'qr' && props.shareUrl && (
        <QrPopover url={props.shareUrl} onClose={() => setPopover('settings')} />
      )}

      {popover === 'end' && (
        <EndClassPopover
          onCancel={() => setPopover('none')}
          onConfirm={() => {
            setPopover('none');
            props.onEndClass();
          }}
        />
      )}

      {popover === 'composer' && (
        <PollComposer
          onCancel={() => setPopover('none')}
          onSubmit={(question, options) => {
            setPopover('none');
            props.onCustomPoll(question, options);
          }}
        />
      )}
    </div>
  );
}

function ConnectionDot({ reconnecting }: { reconnecting: boolean }) {
  if (reconnecting) {
    return (
      <span className="lr-pixel text-[10px] text-(--lr-muted) flex items-center gap-1.5">
        <span className="lr-loader">
          <i />
          <i />
          <i />
        </span>
        reconnecting…
      </span>
    );
  }
  return (
    <span
      className="w-2 h-2 border-2 border-(--lr-dark)"
      style={{ background: 'var(--lr-mint)' }}
      title="Connected"
      aria-label="Connected"
    />
  );
}

function SettingsPopover({
  settings,
  onChange,
  shareUrl,
  onShowQr,
}: {
  shareUrl: string | null;
  onShowQr: () => void;
  settings: OverlaySettings;
  onChange: (next: OverlaySettings) => void;
}) {
  const [copied, setCopied] = useState(false);

  const zones: { value: ReactionZone; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'both', label: 'Both' },
  ];

  return (
    <Popup>
      <p className="lr-pixel text-[10px] tracking-widest mb-1.5">REACTION POSITION</p>
      <div className="flex gap-3 mb-2">
        {zones.map((zone) => (
          <label key={zone.value} className="lr-text text-[12px] flex items-center gap-1.5">
            <input
              type="radio"
              name="lr-zone"
              data-lr-interactive="true"
              className="lr-interactive"
              checked={settings.zone === zone.value}
              onChange={() => onChange({ ...settings, zone: zone.value })}
            />
            {zone.label}
          </label>
        ))}
      </div>
      <div className="lr-rule mb-2" />
      <label className="lr-text text-[12px] flex items-center gap-2">
        <input
          type="checkbox"
          data-lr-interactive="true"
          className="lr-interactive"
          checked={settings.quiet}
          onChange={(e) => onChange({ ...settings, quiet: e.target.checked })}
        />
        Quiet Mode
      </label>

      {/* Latecomers are the reason this lives here: once the overlay is up the
          launcher is hidden, and the professor should not have to dig it out
          to re-share the link. */}
      <div className="lr-rule my-2" />
      <p className="lr-pixel text-[10px] tracking-widest mb-1.5">SHARE WITH CLASS</p>
      <div className="flex gap-2">
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          disabled={!shareUrl}
          title={shareUrl ?? 'Working out the address students should use…'}
          onClick={() => {
            if (shareUrl) void navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          <FontAwesomeIcon icon={copied ? faCheck : faLink} className="mr-1.5" />
          {copied ? 'Copied' : 'Copy Link'}
        </button>
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onShowQr}
        >
          <FontAwesomeIcon icon={faQrcode} className="mr-1.5" />
          Show QR
        </button>
      </div>
    </Popup>
  );
}

/**
 * The join QR, shown from the settings popover so a latecomer can be waved in
 * mid-lecture without leaving the overlay.
 */
function QrPopover({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Popup>
      <div className="flex flex-col items-center gap-2">
        {/* QrCanvas prints the URL beneath itself, so no caption here. */}
        <QrCanvas value={url} />
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-btn-ghost lr-interactive px-2! py-1! text-[11px]!"
          onClick={onClose}
        >
          Back
        </button>
      </div>
    </Popup>
  );
}

function EndClassPopover({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Popup>
      <p className="lr-text text-[12px] leading-snug mb-2 max-w-60">
        End this class? Students will no longer be able to send reactions or questions.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          data-lr-interactive="true"
          className="lr-btn lr-btn-danger lr-interactive px-2! py-1.5! text-[11px]!"
          onClick={onConfirm}
        >
          End Class
        </button>
      </div>
    </Popup>
  );
}
