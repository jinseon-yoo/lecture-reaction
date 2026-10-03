/**
 * The end-of-class report: one PDF, written the moment the professor ends the
 * class, before the session is dropped from memory.
 *
 * Everything the overlay showed during the lecture was designed to be glanced
 * at and forgotten — reactions float for five seconds, questions leave when
 * answered. That is right for the room and wrong for the professor afterwards,
 * who wants to know *when* the class got lost, which questions they never got
 * to, and how the understanding checks actually went. So this is a dashboard
 * on paper: the numbers up top, the class as a timeline underneath, then the
 * polls and every question in full.
 *
 * It is built from the same aggregate material the overlay received. There is
 * no participant id anywhere in it, which is the whole reason it can be
 * written to disk without reopening the privacy boundary in ARCHITECTURE §9.
 *
 * Why pdf-lib and an embedded TrueType face rather than the webview printing
 * itself: printing needs a dialog, and the report has to appear without one
 * while the professor is packing up. Why the font is embedded whole: the
 * subsetter in `@pdf-lib/fontkit` drops the outlines of Hangul glyphs from
 * this face (the PDF's text layer is intact but the page renders blank), so
 * the full 2 MB face goes in and the file is ~1.5 MB. Acceptable for a report
 * that is produced once per lecture.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { LIMITS, REACTION_META, isFaultType, type ReactionType } from '@lr/shared';
import type { Poll, PresenceSample, Question, Session } from './store.js';

/* ------------------------------------------------------------------ */
/* Where things live                                                   */
/* ------------------------------------------------------------------ */

/**
 * The report fonts. Same resolution order as the tunnel binary: an explicit
 * env, then beside the packaged server (Tauri copies the resource folder
 * there), then the repo for a source run.
 */
export function resolveFontsDir(): string | null {
  const override = process.env.LECTURE_FONTS_DIR?.trim();
  if (override) return existsSync(override) ? resolve(override) : null;
  const beside = join(dirname(process.execPath), 'fonts');
  if (existsSync(join(beside, 'NanumGothic-Regular.ttf'))) return beside;
  try {
    const repo = resolve(dirname(new URL(import.meta.url).pathname), '../assets/fonts');
    if (existsSync(join(repo, 'NanumGothic-Regular.ttf'))) return repo;
  } catch {
    /* packaged: no source tree */
  }
  return null;
}

/**
 * Where reports go. The desktop app passes the user's Documents folder in;
 * a bare server run lands in the same place by convention so a professor
 * never has to hunt for it.
 */
export function resolveReportsDir(): string {
  const override = process.env.LECTURE_REPORTS_DIR?.trim();
  return override ? resolve(override) : join(homedir(), 'Documents', 'Lecture React Reports');
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
/*
 * Deliberately not the overlay's pixel-art look. The overlay is glanced at
 * over slides; this is read at a desk and filed. Slate ink on white, one
 * indigo for structure, and data colours chosen for meaning rather than
 * brand: teal for a class that is following, rose for one that is not.
 */

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const mix = (a: RGB, b: RGB, t: number): RGB =>
  rgb(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t);

const INK = hex('#0F172A');
const BODY = hex('#334155');
const MUTED = hex('#64748B');
const FAINT = hex('#94A3B8');
const PAPER = rgb(1, 1, 1);
const RULE = hex('#E2E8F0');
const TRACK = hex('#F1F5F9');
const BRAND = hex('#312E81');
const BRAND_SOFT = hex('#C7D2FE');
const ACCENT = hex('#4F46E5');
const PANEL = hex('#EEF2FF');
const ROUGH_BAND = hex('#FFE4E6');

/** One colour per reaction, so a type reads the same in every chart. */
const REACTION_COLOR: Record<ReactionType, RGB> = {
  understand: hex('#0D9488'),
  love: hex('#DB2777'),
  interesting: hex('#D97706'),
  confused: hex('#E11D48'),
  too_fast: hex('#EA580C'),
  again: hex('#7C3AED'),
  cant_see: hex('#0891B2'),
  cant_hear: hex('#64748B'),
};

/**
 * The timeline reads three signals, not eight. A professor scanning for
 * "where did I lose them" wants trouble in one colour, agreement in another,
 * and the projector/mic faults kept apart because they are not about the
 * teaching at all.
 */
type Signal = 'following' | 'struggling' | 'fault';
const SIGNALS: Signal[] = ['following', 'struggling', 'fault'];
const SIGNAL_OF: Record<ReactionType, Signal> = {
  understand: 'following',
  love: 'following',
  interesting: 'following',
  confused: 'struggling',
  too_fast: 'struggling',
  again: 'struggling',
  cant_see: 'fault',
  cant_hear: 'fault',
};
const SIGNAL_COLOR: Record<Signal, RGB> = {
  following: hex('#0D9488'),
  struggling: hex('#E11D48'),
  fault: hex('#94A3B8'),
};
const SIGNAL_LABEL: Record<Signal, string> = {
  following: 'Following (understand · love it · idea)',
  struggling: 'Struggling (confused · too fast · again)',
  fault: "Can't see / can't hear",
};
/** Heatmap and table order: the three signals, grouped. */
const TYPE_ORDER: ReactionType[] = ['understand', 'interesting', 'love', 'confused', 'too_fast', 'again', 'cant_see', 'cant_hear'];

/* ------------------------------------------------------------------ */
/* Page geometry                                                       */
/* ------------------------------------------------------------------ */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 44;
const CONTENT_W = A4.w - MARGIN * 2;
const FOOTER_H = 30;
const BAND_H = 104;

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const dateLong = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const elapsed = (from: number, to: number) => {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};
const duration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)} min`;
};
const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line, cut with an ellipsis if it would run past `maxW`. */
function clip(font: PDFFont, size: number, maxW: number, text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  let out = '';
  for (const ch of t) {
    if (font.widthOfTextAtSize(`${out}${ch}…`, size) > maxW) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/** pdf-lib has no rounded rectangle; an SVG path is the way to get one. */
function roundRect(
  page: PDFPage,
  o: { x: number; y: number; w: number; h: number; r?: number; color?: RGB; borderColor?: RGB; borderWidth?: number },
): void {
  if (o.w <= 0 || o.h <= 0) return;
  const r = Math.min(o.r ?? 3, o.w / 2, o.h / 2);
  const { w, h } = o;
  const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  // SVG paths are drawn from their top-left corner, y downwards.
  page.drawSvgPath(path, { x: o.x, y: o.y + h, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth });
}

/**
 * Breaks text to fit a width. Words first; a single word wider than the line
 * — a URL, or Korean typed without spaces — is broken by character, because
 * the alternative is a line that runs off the page.
 */
function wrap(font: PDFFont, size: number, maxW: number, text: string): string[] {
  const width = (t: string) => font.widthOfTextAtSize(t, size);
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxW) {
      line = candidate;
      continue;
    }
    push();
    if (width(word) <= maxW) {
      line = word;
      continue;
    }
    let run = '';
    for (const ch of word) {
      if (width(run + ch) > maxW) {
        lines.push(run);
        run = '';
      }
      run += ch;
    }
    line = run;
  }
  push();
  return lines.length ? lines : [''];
}

/* ------------------------------------------------------------------ */
/* A page cursor that knows when to start a new page                  */
/* ------------------------------------------------------------------ */

class Sheet {
  page!: PDFPage;
  y = 0;
  private pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: PAPER });
    this.y = A4.h - MARGIN;
  }

  /** Guarantees `h` points of room below the cursor, turning the page if not. */
  ensure(h: number): void {
    if (this.y - h < MARGIN + FOOTER_H) this.newPage();
  }

  text(t: string, opts: { x?: number; size?: number; bold?: boolean; color?: RGB } = {}): void {
    this.page.drawText(t, {
      x: opts.x ?? MARGIN,
      y: this.y,
      size: opts.size ?? 10,
      font: opts.bold ? this.bold : this.regular,
      color: opts.color ?? INK,
    });
  }

  /** Writes wrapped body text, advancing the cursor; returns lines used. */
  paragraph(t: string, opts: { x?: number; w?: number; size?: number; bold?: boolean; color?: RGB; lead?: number } = {}): number {
    const size = opts.size ?? 10;
    const lead = opts.lead ?? size * 1.4;
    const font = opts.bold ? this.bold : this.regular;
    const lines = wrap(font, size, opts.w ?? CONTENT_W, t);
    for (const line of lines) {
      this.ensure(lead);
      this.y -= lead;
      this.text(line, { ...opts, size });
    }
    return lines.length;
  }

  heading(t: string): void {
    this.ensure(70);
    this.y -= 32;
    roundRect(this.page, { x: MARGIN, y: this.y - 2, w: 3, h: 13, r: 1.5, color: ACCENT });
    this.text(t, { x: MARGIN + 10, size: 12.5, bold: true });
    this.y -= 8;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.w - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= 4;
  }

  /** Page numbers, once every page exists. */
  finish(code: string, dateText: string): void {
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: A4.w - MARGIN, y: MARGIN + 14 }, thickness: 0.5, color: RULE });
      p.drawText(`Lecture React · class ${code} · ${dateText}`, { x: MARGIN, y: MARGIN, size: 8, font: this.regular, color: MUTED });
      const label = `${i + 1} / ${this.pages.length}`;
      p.drawText(label, { x: A4.w - MARGIN - this.regular.widthOfTextAtSize(label, 8), y: MARGIN, size: 8, font: this.regular, color: MUTED });
    });
  }
}

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/* ------------------------------------------------------------------ */

/** The stretch of minutes where trouble signals clustered. */
interface Stretch {
  from: number;
  to: number;
  struggling: number;
  following: number;
  topType: ReactionType;
  topCount: number;
  questions: number;
}

/** One line of the chronological log. */
interface Moment {
  at: number;
  color: RGB;
  text: string;
}

interface Stats {
  startedAt: number;
  endedAt: number;
  span: number;
  peakPresence: number;
  avgPresence: number;
  endPresence: number;
  peakAt: number;
  distinctStudents: number;
  reactionsTotal: number;
  byType: Map<ReactionType, number>;
  bySignal: Record<Signal, number>;
  questions: Question[];
  answered: number;
  polls: Poll[];
  rough: Stretch | null;
}

/** Students connected at `at`, read off the presence step line. */
function presenceAt(log: PresenceSample[], at: number): number {
  let n = 0;
  for (const p of log) {
    if (p.at > at) break;
    n = p.count;
  }
  return n;
}

function pollCounts(poll: Poll): Map<string, number> {
  const counts = new Map<string, number>();
  for (const optionId of poll.responses.values()) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
  return counts;
}

/**
 * Finds the worst minute for trouble signals and grows it outwards while the
 * neighbours are still at least a third as bad. A class with a couple of
 * stray "confused" has no rough stretch, and the report should not invent one.
 */
function findRoughStretch(session: Session, startedAt: number, endedAt: number): Stretch | null {
  const minutes = Math.max(1, Math.ceil((endedAt - startedAt) / 60_000));
  const minuteOf = (at: number) => Math.min(minutes - 1, Math.max(0, Math.floor((at - startedAt) / 60_000)));
  const trouble = new Array<number>(minutes).fill(0);
  for (const s of session.reactionLog) if (SIGNAL_OF[s.type] === 'struggling') trouble[minuteOf(s.at)]! += s.count;
  const peak = Math.max(...trouble);
  if (peak < 3) return null;
  const floor = Math.max(2, peak / 3);
  let lo = trouble.indexOf(peak);
  let hi = lo;
  while (lo > 0 && trouble[lo - 1]! >= floor) lo--;
  while (hi < minutes - 1 && trouble[hi + 1]! >= floor) hi++;

  const from = startedAt + lo * 60_000;
  const to = Math.min(endedAt, startedAt + (hi + 1) * 60_000);
  const inside = (at: number) => at >= from && at < to;
  const byType = new Map<ReactionType, number>();
  let struggling = 0;
  let following = 0;
  for (const s of session.reactionLog) {
    if (!inside(s.at)) continue;
    if (SIGNAL_OF[s.type] === 'following') following += s.count;
    if (SIGNAL_OF[s.type] !== 'struggling') continue;
    struggling += s.count;
    byType.set(s.type, (byType.get(s.type) ?? 0) + s.count);
  }
  const [topType, topCount] = [...byType].sort((a, b) => b[1] - a[1])[0]!;
  const questions = [...session.questions.values()].filter((q) => inside(q.createdAt)).length;
  return { from, to, struggling, following, topType, topCount, questions };
}

function computeStats(session: Session, endedAt: number): Stats {
  const byType = new Map<ReactionType, number>();
  const bySignal: Record<Signal, number> = { following: 0, struggling: 0, fault: 0 };
  let reactionsTotal = 0;
  for (const s of session.reactionLog) {
    byType.set(s.type, (byType.get(s.type) ?? 0) + s.count);
    bySignal[SIGNAL_OF[s.type]] += s.count;
    reactionsTotal += s.count;
  }
  const questions = [...session.questions.values()].sort(
    (a, b) => b.votes - a.votes || a.createdAt - b.createdAt,
  );
  const startedAt = session.startedAt;
  const span = Math.max(60_000, endedAt - startedAt);

  // Time-weighted, so thirty students for an hour is 30, not the mean of the samples.
  let peakPresence = 0;
  let peakAt = startedAt;
  let weighted = 0;
  session.presenceLog.forEach((p, i) => {
    if (p.count > peakPresence) {
      peakPresence = p.count;
      peakAt = p.at;
    }
    const until = session.presenceLog[i + 1]?.at ?? endedAt;
    weighted += p.count * Math.max(0, Math.min(until, endedAt) - Math.max(p.at, startedAt));
  });

  return {
    startedAt,
    endedAt,
    span,
    peakPresence,
    avgPresence: weighted / span,
    endPresence: presenceAt(session.presenceLog, endedAt),
    peakAt,
    distinctStudents: session.participants.size,
    reactionsTotal,
    byType,
    bySignal,
    questions,
    answered: questions.filter((q) => q.status === 'resolved').length,
    polls: session.pollHistory,
    rough: findRoughStretch(session, startedAt, endedAt),
  };
}

/** Shared by the timeline and the heatmap so their columns line up. */
function bucketing(st: Stats) {
  // ≤ 60 buckets so a three-hour lecture is still a bar chart, not a barcode.
  const bucketMs = [60_000, 120_000, 300_000, 600_000].find((b) => st.span / b <= 60) ?? 900_000;
  const buckets = Math.max(1, Math.ceil(st.span / bucketMs));
  const bucketOf = (at: number) => Math.min(buckets - 1, Math.max(0, Math.floor((at - st.startedAt) / bucketMs)));
  return { bucketMs, buckets, bucketOf };
}

/**
 * The class in order: every surge the overlay would have flagged (same
 * thresholds as `Overlay.tsx`), every check, every question, and the two
 * attendance events worth a line.
 */
function collectMoments(session: Session, st: Stats): Moment[] {
  const moments: Moment[] = [];
  const at0 = (at: number) => elapsed(st.startedAt, at);

  // Surges, with repeats of one type inside three minutes folded together.
  const open = new Map<ReactionType, { from: number; to: number; peak: number }>();
  const flush = (type: ReactionType) => {
    const s = open.get(type);
    if (!s) return;
    open.delete(type);
    const label = REACTION_META[type].label;
    const lasted = s.to - s.from >= 60_000 ? `, recurring until +${at0(s.to)}` : '';
    moments.push({
      at: s.from,
      color: REACTION_COLOR[type],
      text: isFaultType(type)
        ? `"${label}" reported by ${plural(s.peak, 'student')} at once${lasted}`
        : `Surge of "${label}": ${s.peak} at once${lasted}`,
    });
  };
  for (const b of [...session.reactionLog].sort((a, b) => a.at - b.at)) {
    const share = Math.max(LIMITS.surgeMinCount, Math.ceil(presenceAt(session.presenceLog, b.at) * LIMITS.surgeShareOfClass));
    if (b.count < (isFaultType(b.type) ? LIMITS.faultSurgeMinCount : share)) continue;
    const cur = open.get(b.type);
    if (cur && b.at - cur.to <= 180_000) {
      cur.to = b.at;
      cur.peak = Math.max(cur.peak, b.count);
    } else {
      flush(b.type);
      open.set(b.type, { from: b.at, to: b.at, peak: b.count });
    }
  }
  for (const type of [...open.keys()]) flush(type);

  for (const poll of st.polls) {
    const n = poll.responses.size;
    const counts = pollCounts(poll);
    const parts = poll.options.map((o) => `${pct(counts.get(o.id) ?? 0, n)}% ${o.label.toLowerCase()}`);
    moments.push({
      at: poll.createdAt,
      color: ACCENT,
      text:
        poll.kind === 'understanding'
          ? `Understanding check: ${n ? parts.join(', ') : 'no answers'}`
          : `Poll "${poll.question}": ${plural(n, 'answer')}`,
    });
  }

  // In a class that asked a great many, the log keeps the ones others backed.
  const loud = st.questions.length > 12 ? st.questions.filter((q) => q.votes >= 2) : st.questions;
  for (const q of loud) {
    moments.push({ at: q.createdAt, color: hex('#D97706'), text: `Question (${plural(q.votes, 'vote')}): ${q.text}` });
  }

  if (st.peakPresence > 0) {
    moments.push({ at: st.peakAt, color: FAINT, text: `Attendance reached its peak of ${st.peakPresence}` });
    const drop = session.presenceLog.find((p) => p.at > st.peakAt && p.count <= st.peakPresence * 0.85);
    if (drop) moments.push({ at: drop.at, color: FAINT, text: `Attendance down to ${drop.count}` });
  }
  return moments.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function drawHeader(sh: Sheet, session: Session, st: Stats): void {
  const p = sh.page;
  const top = A4.h;
  p.drawRectangle({ x: 0, y: top - BAND_H, width: A4.w, height: BAND_H, color: BRAND });
  p.drawRectangle({ x: 0, y: top - BAND_H - 3, width: A4.w, height: 3, color: ACCENT });
  p.drawText('LECTURE REACT', { x: MARGIN, y: top - 34, size: 7.5, font: sh.bold, color: BRAND_SOFT });
  p.drawText('Class report', { x: MARGIN, y: top - 62, size: 25, font: sh.bold, color: PAPER });
  p.drawText(dateLong(st.startedAt), { x: MARGIN, y: top - 82, size: 10.5, font: sh.regular, color: BRAND_SOFT });

  const right = (t: string, y: number, size: number, font: PDFFont, color: RGB) =>
    p.drawText(t, { x: A4.w - MARGIN - font.widthOfTextAtSize(t, size), y, size, font, color });
  right('CLASS CODE', top - 34, 7.5, sh.bold, BRAND_SOFT);
  right(session.code, top - 58, 20, sh.bold, PAPER);
  right(`${clock(st.startedAt)} – ${clock(st.endedAt)}  ·  ${duration(st.endedAt - st.startedAt)}`, top - 82, 10.5, sh.regular, BRAND_SOFT);
  sh.y = top - BAND_H - 3 - 10;
}

function drawKpis(sh: Sheet, st: Stats): void {
  const checks = st.polls.filter((p) => p.kind === 'understanding');
  const lastCheck = checks[checks.length - 1];
  const minutes = st.span / 60_000;
  const tiles: [string, string, string, RGB][] = [
    ['STUDENTS', String(st.peakPresence), `${st.distinctStudents} joined · ${st.endPresence} at the end`, ACCENT],
    ['REACTIONS', String(st.reactionsTotal), `${(st.reactionsTotal / minutes).toFixed(1)} a minute${st.peakPresence ? ` · ${(st.reactionsTotal / st.peakPresence).toFixed(1)} per student` : ''}`, SIGNAL_COLOR.following],
    ['QUESTIONS', String(st.questions.length), `${st.answered} answered · ${st.questions.length - st.answered} open`, hex('#D97706')],
    [
      'CHECKS & POLLS',
      String(st.polls.length),
      lastCheck ? `last check: ${pct(pollCounts(lastCheck).get('got_it') ?? 0, lastCheck.responses.size)}% got it` : st.polls.length ? 'no understanding check' : 'none run',
      SIGNAL_COLOR.struggling,
    ],
  ];
  const gap = 10;
  const w = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
  const h = 66;
  sh.y -= h + 10;
  tiles.forEach(([label, value, sub, color], i) => {
    const x = MARGIN + i * (w + gap);
    roundRect(sh.page, { x, y: sh.y, w, h, r: 5, color: PAPER, borderColor: RULE, borderWidth: 0.8 });
    roundRect(sh.page, { x: x + 11, y: sh.y + h - 15, w: 3, h: 7, r: 1.5, color });
    sh.page.drawText(label, { x: x + 19, y: sh.y + h - 15, size: 7, font: sh.bold, color: MUTED });
    sh.page.drawText(value, { x: x + 11, y: sh.y + 23, size: 23, font: sh.bold, color: INK });
    sh.page.drawText(clip(sh.regular, 7.2, w - 20, sub), { x: x + 11, y: sh.y + 9, size: 7.2, font: sh.regular, color: MUTED });
  });
}

/**
 * The findings a professor would otherwise have to read off the charts,
 * stated in sentences. Every line is derived from the same aggregates below
 * it; a line with nothing to say is left out rather than padded.
 */
function drawAtAGlance(sh: Sheet, st: Stats): void {
  const facts: [string, string][] = [];
  if (st.reactionsTotal > 0) {
    facts.push([
      'Overall',
      `${pct(st.bySignal.following, st.reactionsTotal)}% of reactions said the class was following, ${pct(st.bySignal.struggling, st.reactionsTotal)}% signalled trouble` +
        (st.bySignal.fault ? `, and ${plural(st.bySignal.fault, 'was a', 'were')} can't-see / can't-hear ${st.bySignal.fault === 1 ? 'report' : 'reports'}.` : '.'),
    ]);
  }
  if (st.rough) {
    const r = st.rough;
    facts.push([
      'Roughest stretch',
      `+${elapsed(st.startedAt, r.from)} to +${elapsed(st.startedAt, r.to)} (${clock(r.from)}–${clock(r.to)}): ${r.struggling} trouble signals against ${r.following} following, mostly "${REACTION_META[r.topType].label}" (${r.topCount}).` +
        (r.questions ? ` ${plural(r.questions, 'question was', 'questions were')} asked during it.` : ''),
    ]);
  }
  const checks = st.polls.filter((p) => p.kind === 'understanding' && p.responses.size > 0);
  if (checks.length) {
    facts.push([
      'Understanding',
      checks.map((p, i) => `check ${i + 1} at +${elapsed(st.startedAt, p.createdAt)}: ${pct(pollCounts(p).get('got_it') ?? 0, p.responses.size)}% got it`).join('  →  ') + '.',
    ]);
  }
  const open = st.questions.filter((q) => q.status !== 'resolved');
  if (open.length) {
    facts.push([
      'To follow up',
      `${plural(open.length, 'question was', 'questions were')} not answered in class. Most voted (${plural(open[0]!.votes, 'vote')}): "${open[0]!.text}"`,
    ]);
  }
  if (st.peakPresence > 0) {
    facts.push([
      'Attendance',
      `${st.peakPresence} at the peak (from +${elapsed(st.startedAt, st.peakAt)}), ${st.avgPresence.toFixed(1)} on average, ${st.endPresence} still connected at the end.`,
    ]);
  }
  if (facts.length === 0) return;

  const labelW = 92;
  const padX = 14;
  const size = 9;
  const lead = 12.5;
  const rowGap = 5;
  const textW = CONTENT_W - padX * 2 - labelW;
  const rows = facts.map(([label, text]) => ({ label, lines: wrap(sh.regular, size, textW, text) }));
  const h = 30 + rows.reduce((sum, r) => sum + r.lines.length * lead + rowGap, 0) + 6;
  sh.ensure(h + 14);
  sh.y -= h + 14;
  roundRect(sh.page, { x: MARGIN, y: sh.y, w: CONTENT_W, h, r: 6, color: PANEL });
  let y = sh.y + h - 19;
  sh.page.drawText('AT A GLANCE', { x: MARGIN + padX, y, size: 7.5, font: sh.bold, color: ACCENT });
  y -= 6;
  for (const r of rows) {
    r.lines.forEach((line, i) => {
      y -= lead;
      if (i === 0) sh.page.drawText(r.label, { x: MARGIN + padX, y, size, font: sh.bold, color: BRAND });
      sh.page.drawText(line, { x: MARGIN + padX + labelW, y, size, font: sh.regular, color: BODY });
    });
    y -= rowGap;
  }
}

/**
 * The class as a timeline: one stacked bar per bucket of reactions, the
 * presence line over it, a tick for every understanding check, and under it
 * the same buckets split by reaction type. This is the chart that answers
 * "when did they stop following" — and the strip below it answers "how".
 */
function drawTimeline(sh: Sheet, session: Session, st: Stats): void {
  sh.heading('The room over time');
  const { bucketMs, buckets, bucketOf } = bucketing(st);
  const span = st.span;

  const stacks: Record<Signal, number>[] = Array.from({ length: buckets }, () => ({ following: 0, struggling: 0, fault: 0 }));
  const cells = new Map<ReactionType, number[]>();
  for (const s of session.reactionLog) {
    const b = bucketOf(s.at);
    stacks[b]![SIGNAL_OF[s.type]] += s.count;
    let row = cells.get(s.type);
    if (!row) cells.set(s.type, (row = new Array<number>(buckets).fill(0)));
    row[b]! += s.count;
  }
  const tallest = stacks.reduce((m, b) => Math.max(m, b.following + b.struggling + b.fault), 0);
  const heatRows = TYPE_ORDER.filter((t) => cells.has(t));
  const heatRowH = 13;

  const chartH = 140;
  const axisLeft = 62;
  const plotX = MARGIN + axisLeft;
  const plotW = CONTENT_W - axisLeft - 26;

  if (st.reactionsTotal === 0 && st.peakPresence === 0) {
    sh.paragraph('Nothing was recorded during this class.', { color: MUTED });
    return;
  }

  sh.ensure(chartH + 24 + 34 + heatRows.length * heatRowH + 50);
  sh.y -= chartH + 24;
  const base = sh.y;
  const px = (at: number) => plotX + Math.min(1, Math.max(0, (at - st.startedAt) / span)) * plotW;

  // The roughest stretch, shaded behind everything else.
  if (st.rough) {
    sh.page.drawRectangle({ x: px(st.rough.from), y: base, width: px(st.rough.to) - px(st.rough.from), height: chartH, color: ROUGH_BAND });
  }

  // Gridlines and the left axis (reactions per bucket).
  const yMax = Math.max(1, tallest);
  for (let i = 0; i <= 4; i++) {
    const y = base + (chartH * i) / 4;
    sh.page.drawLine({ start: { x: plotX, y }, end: { x: plotX + plotW, y }, thickness: i === 0 ? 0.8 : 0.5, color: i === 0 ? FAINT : RULE });
    const v = String(Math.round((yMax * i) / 4));
    sh.page.drawText(v, { x: plotX - 6 - sh.regular.widthOfTextAtSize(v, 7), y: y - 2.5, size: 7, font: sh.regular, color: MUTED });
  }
  const perBucket = `reactions per ${bucketMs === 60_000 ? 'minute' : `${bucketMs / 60_000} min`}`;
  sh.page.drawText(perBucket, { x: plotX, y: base + chartH + 6, size: 6.5, font: sh.regular, color: FAINT });
  sh.page.drawText('students', { x: plotX + plotW - sh.regular.widthOfTextAtSize('students', 6.5), y: base + chartH + 6, size: 6.5, font: sh.regular, color: FAINT });

  // Bars.
  const slot = plotW / buckets;
  const barW = Math.max(2, slot * 0.72);
  stacks.forEach((b, i) => {
    let y = base;
    const x = plotX + i * slot + (slot - barW) / 2;
    for (const sig of SIGNALS) {
      const h = (b[sig] / yMax) * chartH;
      if (h <= 0) continue;
      sh.page.drawRectangle({ x, y, width: barW, height: h, color: SIGNAL_COLOR[sig] });
      y += h;
    }
  });

  // Presence line, right axis, drawn as a step so a join shows where it happened.
  const pMax = Math.max(1, st.peakPresence);
  const py = (n: number) => base + (n / pMax) * chartH;
  const samples = [{ at: st.startedAt, count: 0 }, ...session.presenceLog];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    const nextAt = samples[i + 1]?.at ?? st.endedAt;
    sh.page.drawLine({ start: { x: px(a.at), y: py(a.count) }, end: { x: px(nextAt), y: py(a.count) }, thickness: 1.3, color: ACCENT });
    if (samples[i + 1]) {
      sh.page.drawLine({ start: { x: px(nextAt), y: py(a.count) }, end: { x: px(nextAt), y: py(samples[i + 1]!.count) }, thickness: 1.3, color: ACCENT });
    }
  }
  for (let i = 0; i <= 2; i++) {
    const v = String(Math.round((pMax * i) / 2));
    sh.page.drawText(v, { x: plotX + plotW + 6, y: base + (chartH * i) / 2 - 2.5, size: 7, font: sh.regular, color: ACCENT });
  }

  // A tick per poll, on the time axis.
  for (const poll of st.polls) {
    const x = px(poll.createdAt);
    sh.page.drawLine({ start: { x, y: base }, end: { x, y: base + chartH }, thickness: 0.7, color: MUTED, dashArray: [2, 2] });
    sh.page.drawText('▲', { x: x - 3, y: base - 9, size: 6.5, font: sh.regular, color: INK });
  }

  // Time axis: a label every few buckets, clock times at the ends.
  const every = Math.max(1, Math.ceil(buckets / 8));
  for (let i = 0; i < buckets; i += every) {
    const label = `+${Math.round((i * bucketMs) / 60_000)}m`;
    sh.page.drawText(label, { x: plotX + i * slot, y: base - 19, size: 7, font: sh.regular, color: MUTED });
  }
  sh.page.drawText(clock(st.startedAt), { x: MARGIN, y: base - 19, size: 7, font: sh.bold, color: MUTED });
  sh.page.drawText(clock(st.endedAt), { x: plotX + plotW + 6, y: base - 19, size: 7, font: sh.bold, color: MUTED });

  // The same buckets by reaction type: darker is more, scaled by square root
  // so a handful of "again" is still visible beside a wall of "understand".
  sh.y = base - 28;
  const cellMax = Math.max(1, ...[...cells.values()].flat());
  for (const type of heatRows) {
    sh.y -= heatRowH;
    const row = cells.get(type)!;
    sh.page.drawText(REACTION_META[type].label, { x: MARGIN, y: sh.y + 3, size: 7.5, font: sh.regular, color: BODY });
    row.forEach((n, i) => {
      const color = n === 0 ? TRACK : mix(PAPER, REACTION_COLOR[type], 0.22 + 0.78 * Math.sqrt(n / cellMax));
      sh.page.drawRectangle({ x: plotX + i * slot + 0.5, y: sh.y + 1, width: Math.max(1, slot - 1), height: heatRowH - 2, color });
    });
    const total = String(st.byType.get(type) ?? 0);
    sh.page.drawText(total, { x: plotX + plotW + 6, y: sh.y + 3, size: 7, font: sh.regular, color: MUTED });
  }

  // Legend.
  sh.y -= 18;
  let lx = MARGIN;
  const item = (draw: (x: number) => number, label: string) => {
    const w = draw(lx);
    sh.page.drawText(label, { x: lx + w + 4, y: sh.y, size: 7.2, font: sh.regular, color: BODY });
    lx += w + 4 + sh.regular.widthOfTextAtSize(label, 7.2) + 12;
  };
  const swatch = (c: RGB) => (x: number) => {
    roundRect(sh.page, { x, y: sh.y - 1, w: 8, h: 8, r: 2, color: c });
    return 8;
  };
  for (const sig of SIGNALS) item(swatch(SIGNAL_COLOR[sig]), SIGNAL_LABEL[sig]);
  sh.y -= 13;
  lx = MARGIN;
  item((x) => {
    sh.page.drawLine({ start: { x, y: sh.y + 3 }, end: { x: x + 14, y: sh.y + 3 }, thickness: 1.3, color: ACCENT });
    return 14;
  }, 'Students connected (right axis)');
  if (st.polls.length) {
    item((x) => {
      sh.page.drawText('▲', { x, y: sh.y, size: 6.5, font: sh.regular, color: INK });
      return 7;
    }, 'Understanding check / poll');
  }
  if (st.rough) item(swatch(ROUGH_BAND), 'Roughest stretch');
  sh.y -= 4;
}

function drawReactionBreakdown(sh: Sheet, session: Session, st: Stats): void {
  sh.heading('Reactions');
  if (st.reactionsTotal === 0) {
    sh.paragraph('No reactions were sent.', { color: MUTED });
    return;
  }
  // The single busiest minute for each type.
  const busiest = new Map<ReactionType, { minute: number; n: number }>();
  const perMinute = new Map<string, number>();
  for (const s of session.reactionLog) {
    const minute = Math.max(0, Math.floor((s.at - st.startedAt) / 60_000));
    const key = `${s.type}:${minute}`;
    const n = (perMinute.get(key) ?? 0) + s.count;
    perMinute.set(key, n);
    if (n > (busiest.get(s.type)?.n ?? 0)) busiest.set(s.type, { minute, n });
  }

  const rows = TYPE_ORDER.map((t) => ({ type: t, n: st.byType.get(t) ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const labelW = 74;
  const numW = 150;
  const barW = CONTENT_W - labelW - numW;
  const rowH = 17;
  sh.ensure(rows.length * rowH + 24);
  sh.y -= 14;
  const head = (t: string, x: number) => sh.page.drawText(t, { x, y: sh.y, size: 6.5, font: sh.bold, color: FAINT });
  head('SHARE OF ALL REACTIONS', MARGIN + labelW);
  head('COUNT', MARGIN + labelW + barW + 10);
  head('BUSIEST MINUTE', MARGIN + labelW + barW + 66);
  sh.y -= 2;
  for (const r of rows) {
    sh.y -= rowH;
    const meta = REACTION_META[r.type];
    sh.page.drawText(meta.label, { x: MARGIN, y: sh.y + 3.5, size: 9, font: sh.bold, color: INK });
    roundRect(sh.page, { x: MARGIN + labelW, y: sh.y + 1, w: barW, h: 11, r: 3, color: TRACK });
    roundRect(sh.page, { x: MARGIN + labelW, y: sh.y + 1, w: Math.max(3, (r.n / st.reactionsTotal) * barW), h: 11, r: 3, color: REACTION_COLOR[r.type] });
    sh.page.drawText(`${r.n}  ·  ${pct(r.n, st.reactionsTotal)}%`, { x: MARGIN + labelW + barW + 10, y: sh.y + 3.5, size: 8.5, font: sh.regular, color: INK });
    const b = busiest.get(r.type)!;
    sh.page.drawText(`+${b.minute} min  (${b.n})`, { x: MARGIN + labelW + barW + 66, y: sh.y + 3.5, size: 8.5, font: sh.regular, color: MUTED });
  }
  sh.y -= 4;
}

function drawMoments(sh: Sheet, session: Session, st: Stats): void {
  const moments = collectMoments(session, st);
  if (moments.length === 0) return;
  sh.heading('Key moments, in order');
  const timeW = 78;
  sh.y -= 4;
  for (const m of moments) {
    const lines = wrap(sh.regular, 9, CONTENT_W - timeW - 14, m.text).slice(0, 2);
    sh.ensure(lines.length * 12 + 8);
    sh.y -= 15;
    sh.page.drawText(`+${elapsed(st.startedAt, m.at)}`, { x: MARGIN, y: sh.y, size: 8.5, font: sh.bold, color: INK });
    sh.page.drawText(clock(m.at), { x: MARGIN + 40, y: sh.y, size: 7.5, font: sh.regular, color: FAINT });
    sh.page.drawCircle({ x: MARGIN + timeW + 3, y: sh.y + 3, size: 2.6, color: m.color });
    lines.forEach((line, i) => {
      if (i > 0) sh.y -= 12;
      sh.page.drawText(line, { x: MARGIN + timeW + 14, y: sh.y, size: 9, font: sh.regular, color: BODY });
    });
  }
  sh.y -= 4;
}

function drawPolls(sh: Sheet, session: Session, st: Stats): void {
  sh.heading('Understanding checks and polls');
  if (st.polls.length === 0) {
    sh.paragraph('No understanding check was run.', { color: MUTED });
    return;
  }
  let checkNo = 0;
  let prevGotIt: number | null = null;
  st.polls.forEach((poll, i) => {
    const n = poll.responses.size;
    const counts = pollCounts(poll);
    sh.ensure(62 + poll.options.length * 16);
    sh.y -= 20;
    const isCheck = poll.kind === 'understanding';
    if (isCheck) checkNo++;
    const when = `+${elapsed(st.startedAt, poll.createdAt)}  ·  ${clock(poll.createdAt)}`;
    sh.text(`${i + 1}.`, { size: 9, bold: true, color: ACCENT });
    sh.paragraph(isCheck ? `Understanding check ${checkNo}` : poll.question, { x: MARGIN + 16, w: CONTENT_W - 16 - 110, size: 10.5, bold: true, lead: 0 });
    sh.page.drawText(when, { x: A4.w - MARGIN - sh.regular.widthOfTextAtSize(when, 8), y: sh.y, size: 8, font: sh.regular, color: MUTED });
    sh.y -= 4;
    const labelW = 120;
    const numW = 70;
    const barW = CONTENT_W - 16 - labelW - numW;
    for (const opt of poll.options) {
      sh.ensure(16);
      sh.y -= 15;
      const c = counts.get(opt.id) ?? 0;
      sh.page.drawText(clip(sh.regular, 8.5, labelW - 8, opt.label), { x: MARGIN + 16, y: sh.y + 2.5, size: 8.5, font: sh.regular, color: BODY });
      roundRect(sh.page, { x: MARGIN + 16 + labelW, y: sh.y, w: barW, h: 10, r: 3, color: TRACK });
      if (c > 0) roundRect(sh.page, { x: MARGIN + 16 + labelW, y: sh.y, w: Math.max(3, (c / n) * barW), h: 10, r: 3, color: pollColor(poll, opt.id) });
      sh.page.drawText(`${pct(c, n)}%  (${c})`, { x: MARGIN + 16 + labelW + barW + 8, y: sh.y + 2.5, size: 8, font: sh.regular, color: INK });
    }

    // What the tally alone does not say: how many answered, how long it was
    // open, what the room was doing just before, and which way it moved.
    const connected = Math.max(n, presenceAt(session.presenceLog, poll.endedAt ?? poll.createdAt));
    const notes = [`${n} of ${connected} connected answered (${pct(n, connected)}%)`];
    if (poll.endedAt) notes.push(`open for ${elapsed(poll.createdAt, poll.endedAt)}`);
    const before: Record<Signal, number> = { following: 0, struggling: 0, fault: 0 };
    for (const s of session.reactionLog) if (s.at < poll.createdAt && s.at >= poll.createdAt - 180_000) before[SIGNAL_OF[s.type]] += s.count;
    if (before.following + before.struggling > 0) notes.push(`3 min before: ${before.following} following, ${before.struggling} struggling`);
    if (isCheck && n > 0) {
      const gotIt = pct(counts.get('got_it') ?? 0, n);
      if (prevGotIt !== null && gotIt !== prevGotIt) {
        notes.push(`"Got it" ${gotIt > prevGotIt ? 'up' : 'down'} ${Math.abs(gotIt - prevGotIt)} points since check ${checkNo - 1}`);
      }
      prevGotIt = gotIt;
    }
    sh.y -= 13;
    sh.text(clip(sh.regular, 7.8, CONTENT_W - 16, notes.join('  ·  ')), { x: MARGIN + 16, size: 7.8, color: MUTED });
    sh.y -= 2;
  });
}

function pollColor(poll: Poll, optionId: string): RGB {
  if (poll.kind === 'understanding') {
    return optionId === 'got_it' ? SIGNAL_COLOR.following : optionId === 'almost' ? hex('#D97706') : SIGNAL_COLOR.struggling;
  }
  const order = ['#4F46E5', '#0891B2', '#7C3AED', '#0D9488', '#DB2777', '#D97706'];
  return hex(order[Math.max(0, poll.options.findIndex((o) => o.id === optionId)) % order.length]!);
}

function drawQuestions(sh: Sheet, st: Stats): void {
  sh.heading(`Questions (${st.questions.length}, most voted first)`);
  if (st.questions.length === 0) {
    sh.paragraph('No questions were asked.', { color: MUTED });
    return;
  }
  const waits = st.questions
    .filter((q) => q.status === 'resolved' && q.resolvedAt)
    .map((q) => q.resolvedAt! - q.createdAt)
    .sort((a, b) => a - b);
  const summary = [
    `${st.answered} answered, ${st.questions.length - st.answered} left open`,
    `${plural(st.questions.reduce((sum, q) => sum + q.votes, 0), 'vote')} in total`,
  ];
  if (waits.length) summary.push(`median wait for an answer ${elapsed(0, waits[Math.floor(waits.length / 2)]!)}`);
  sh.y -= 14;
  sh.text(summary.join('  ·  '), { size: 8.5, color: MUTED });
  sh.y -= 2;

  const gutter = 70;
  for (const q of st.questions) {
    sh.ensure(50);
    sh.y -= 17;
    const top = sh.y;
    const resolved = q.status === 'resolved' && q.resolvedAt !== undefined;
    sh.text(plural(q.votes, 'vote'), { size: 9.5, bold: true, color: resolved ? INK : SIGNAL_COLOR.struggling });
    sh.page.drawText(`+${elapsed(st.startedAt, q.createdAt)} · ${clock(q.createdAt)}`, { x: MARGIN, y: top - 11, size: 7, font: sh.regular, color: MUTED });
    if (st.peakPresence > 0) {
      sh.page.drawText(`${Math.min(100, pct(q.votes, st.peakPresence))}% of the class`, { x: MARGIN, y: top - 20, size: 7, font: sh.regular, color: FAINT });
    }
    sh.y = top + 11;
    sh.paragraph(q.text, { x: MARGIN + gutter, w: CONTENT_W - gutter, size: 10, lead: 13.5 });
    sh.y -= 14;
    const status = resolved
      ? `Answered at +${elapsed(st.startedAt, q.resolvedAt!)}  ·  after ${elapsed(q.createdAt, q.resolvedAt!)}`
      : 'Not answered during class';
    roundRect(sh.page, {
      x: MARGIN + gutter, y: sh.y - 3, w: sh.regular.widthOfTextAtSize(status, 7.5) + 12, h: 13, r: 6.5,
      color: resolved ? hex('#CCFBF1') : hex('#FFE4E6'),
    });
    sh.page.drawText(status, { x: MARGIN + gutter + 6, y: sh.y + 0.5, size: 7.5, font: sh.regular, color: resolved ? hex('#115E59') : hex('#9F1239') });
    sh.y = Math.min(sh.y, top - 22) - 6;
    sh.page.drawLine({ start: { x: MARGIN, y: sh.y - 2 }, end: { x: A4.w - MARGIN, y: sh.y - 2 }, thickness: 0.5, color: RULE });
    sh.y -= 2;
  }
}

/**
 * The appendix: the whole class as a table, for the professor who wants to
 * line a row up against their slides. One row per minute for an ordinary
 * lecture, coarser for a long one so it stays a few pages.
 */
function drawMinuteTable(sh: Sheet, session: Session, st: Stats): void {
  if (st.reactionsTotal === 0 && st.questions.length === 0 && st.polls.length === 0) return;
  const rowMs = st.span <= 75 * 60_000 ? 60_000 : st.span <= 150 * 60_000 ? 120_000 : 300_000;
  const rows = Math.max(1, Math.ceil(st.span / rowMs));
  const rowOf = (at: number) => Math.min(rows - 1, Math.max(0, Math.floor((at - st.startedAt) / rowMs)));

  const counts = Array.from({ length: rows }, () => new Map<ReactionType, number>());
  for (const s of session.reactionLog) {
    const m = counts[rowOf(s.at)]!;
    m.set(s.type, (m.get(s.type) ?? 0) + s.count);
  }
  const asked = new Array<number>(rows).fill(0);
  for (const q of st.questions) asked[rowOf(q.createdAt)]!++;
  const notes = new Array<string>(rows).fill('');
  for (const p of st.polls) notes[rowOf(p.createdAt)] = p.kind === 'understanding' ? 'Check' : 'Poll';
  const cellMax = Math.max(1, ...counts.flatMap((m) => [...m.values()]));

  const shortLabel: Record<ReactionType, string> = {
    understand: 'Underst.', interesting: 'Interest.', love: 'Love it', confused: 'Confused',
    too_fast: 'Too fast', again: 'Again', cant_see: "Can't see", cant_hear: "Can't hear",
  };
  const cols: { label: string; w: number }[] = [
    { label: 'Time', w: 36 }, { label: 'Clock', w: 36 }, { label: 'Students', w: 40 },
    ...TYPE_ORDER.map((t) => ({ label: shortLabel[t], w: 40 })),
    { label: 'Questions', w: 40 }, { label: 'Event', w: CONTENT_W - 36 - 36 - 40 - 40 * 8 - 40 },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), MARGIN);
  const center = (t: string, col: number, y: number, font: PDFFont, size: number, color: RGB) =>
    sh.page.drawText(t, { x: xs[col]! + (cols[col]!.w - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });

  const rowH = 12.5;
  const header = () => {
    sh.y -= 18;
    sh.page.drawRectangle({ x: MARGIN, y: sh.y - 4, width: CONTENT_W, height: 15, color: TRACK });
    cols.forEach((c, i) => center(c.label, i, sh.y, sh.bold, 6.5, i >= 3 && i < 11 ? REACTION_COLOR[TYPE_ORDER[i - 3]!] : MUTED));
    sh.y -= 5;
  };

  const unit = rowMs === 60_000 ? 'Minute by minute' : `Every ${rowMs / 60_000} minutes`;
  sh.heading(unit);
  sh.ensure(18 + rowH * 4);
  header();
  for (let r = 0; r < rows; r++) {
    if (sh.y - rowH < MARGIN + FOOTER_H) {
      sh.newPage();
      header();
    }
    sh.y -= rowH;
    const at = st.startedAt + r * rowMs;
    const y = sh.y + 3;
    if (st.rough && at >= st.rough.from && at < st.rough.to) {
      sh.page.drawRectangle({ x: MARGIN, y: sh.y, width: 2, height: rowH, color: SIGNAL_COLOR.struggling });
    }
    center(`+${Math.round((r * rowMs) / 60_000)}`, 0, y, sh.bold, 7.5, INK);
    center(clock(at), 1, y, sh.regular, 7.5, MUTED);
    center(String(presenceAt(session.presenceLog, Math.min(st.endedAt, at + rowMs) - 1)), 2, y, sh.regular, 7.5, BODY);
    TYPE_ORDER.forEach((type, i) => {
      const n = counts[r]!.get(type) ?? 0;
      if (n === 0) return void center('·', 3 + i, y, sh.regular, 7.5, RULE);
      const t = Math.sqrt(n / cellMax);
      roundRect(sh.page, { x: xs[3 + i]! + 5, y: sh.y + 1, w: cols[3 + i]!.w - 10, h: rowH - 2, r: 2.5, color: mix(PAPER, REACTION_COLOR[type], 0.14 + 0.7 * t) });
      center(String(n), 3 + i, y, sh.bold, 7.5, t > 0.6 ? PAPER : INK);
    });
    if (asked[r]) center(String(asked[r]), 11, y, sh.bold, 7.5, hex('#B45309'));
    else center('·', 11, y, sh.regular, 7.5, RULE);
    if (notes[r]) center(notes[r]!, 12, y, sh.bold, 7, ACCENT);
    sh.page.drawLine({ start: { x: MARGIN, y: sh.y }, end: { x: A4.w - MARGIN, y: sh.y }, thickness: 0.4, color: RULE });
  }
  if (st.rough) {
    sh.ensure(16);
    sh.y -= 14;
    sh.page.drawRectangle({ x: MARGIN, y: sh.y - 1, width: 2, height: 9, color: SIGNAL_COLOR.struggling });
    sh.text('Rows inside the roughest stretch. Darker cells are more reactions.', { x: MARGIN + 8, size: 7.2, color: MUTED });
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/** The PDF bytes for a session. Pure: no filesystem beyond reading the fonts. */
export async function buildReportPdf(session: Session, endedAt = session.endedAt ?? Date.now()): Promise<Uint8Array> {
  const fontsDir = resolveFontsDir();
  if (!fontsDir) throw new Error('report fonts not found (set LECTURE_FONTS_DIR)');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Whole face, not a subset — see the header comment.
  const regular = await doc.embedFont(readFileSync(join(fontsDir, 'NanumGothic-Regular.ttf')), { subset: false });
  const bold = await doc.embedFont(readFileSync(join(fontsDir, 'NanumGothic-Bold.ttf')), { subset: false });
  doc.setTitle(`Lecture React — class ${session.code}`);
  doc.setProducer('Lecture React');
  doc.setCreationDate(new Date(endedAt));

  const st = computeStats(session, endedAt);
  const sh = new Sheet(doc, regular, bold);
  drawHeader(sh, session, st);
  drawKpis(sh, st);
  drawAtAGlance(sh, st);
  drawTimeline(sh, session, st);
  drawReactionBreakdown(sh, session, st);
  drawMoments(sh, session, st);
  drawPolls(sh, session, st);
  drawQuestions(sh, st);
  drawMinuteTable(sh, session, st);
  sh.finish(session.code, dateLong(st.startedAt));
  return doc.save();
}

/** Writes the report and returns its path. Never throws into the hub. */
export async function writeReport(session: Session, endedAt: number): Promise<{ path: string } | { error: string }> {
  try {
    const bytes = await buildReportPdf(session, endedAt);
    const dir = resolveReportsDir();
    mkdirSync(dir, { recursive: true });
    const d = new Date(session.startedAt);
    const name = `Lecture-React-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}-${session.code}.pdf`;
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return { path };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[lecture-react] report failed: ${error}`);
    return { error };
  }
}
