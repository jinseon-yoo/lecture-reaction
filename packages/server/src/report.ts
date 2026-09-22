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
import { REACTION_META, REACTION_TYPES, isFaultType, type PaletteKey, type ReactionType } from '@lr/shared';
import type { Poll, Question, Session } from './store.js';

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
 * over slides; this is read at a desk and filed. Ink on white, one navy for
 * emphasis, three restrained data colours and thin rules — nothing that
 * would look out of place next to a gradebook export.
 */

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const INK = hex('#1F2933');
const NAVY = hex('#1F3A5F');
const MUTED = hex('#6B7280');
const PAPER = rgb(1, 1, 1);
const RULE = hex('#E5E7EB');
const TILE = hex('#F3F4F6');
const TRACK = hex('#EEF0F3');
const WHITE = rgb(1, 1, 1);

/** Data colours keyed by the shared palette names, muted for print. */
const ACCENT: Record<PaletteKey, RGB> = {
  sky: hex('#4A7FB5'),
  pink: hex('#C2607A'),
  lavender: hex('#7C6BB0'),
  mint: hex('#3F8F7A'),
  yellow: hex('#D19A2B'),
  peach: hex('#D9784A'),
  sage: hex('#7A9B4E'),
  aqua: hex('#3F8FA3'),
};

/**
 * The timeline reads three signals, not eight. A professor scanning for
 * "where did I lose them" wants trouble in one colour, agreement in another,
 * and the projector/mic faults kept apart because they are not about the
 * teaching at all.
 */
type Signal = 'following' | 'struggling' | 'fault';
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
  following: hex('#3F8F7A'),
  struggling: hex('#D9784A'),
  fault: hex('#9CA3AF'),
};
const SIGNAL_LABEL: Record<Signal, string> = {
  following: 'Following (understand · love it · interesting)',
  struggling: 'Struggling (confused · too fast · again)',
  fault: "Can't see / can't hear",
};

/* ------------------------------------------------------------------ */
/* Page geometry                                                       */
/* ------------------------------------------------------------------ */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 44;
const CONTENT_W = A4.w - MARGIN * 2;
const FOOTER_H = 30;

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
    this.ensure(44);
    this.y -= 30;
    this.text(t, { size: 12.5, bold: true, color: NAVY });
    this.y -= 7;
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

interface Stats {
  startedAt: number;
  endedAt: number;
  peakPresence: number;
  distinctStudents: number;
  reactionsTotal: number;
  byType: Map<ReactionType, number>;
  questions: Question[];
  answered: number;
  polls: Poll[];
}

function computeStats(session: Session, endedAt: number): Stats {
  const byType = new Map<ReactionType, number>();
  let reactionsTotal = 0;
  for (const s of session.reactionLog) {
    byType.set(s.type, (byType.get(s.type) ?? 0) + s.count);
    reactionsTotal += s.count;
  }
  const questions = [...session.questions.values()].sort(
    (a, b) => b.votes - a.votes || a.createdAt - b.createdAt,
  );
  return {
    startedAt: session.startedAt,
    endedAt,
    peakPresence: session.presenceLog.reduce((m, p) => Math.max(m, p.count), 0),
    distinctStudents: session.participants.size,
    reactionsTotal,
    byType,
    questions,
    answered: questions.filter((q) => q.status === 'resolved').length,
    polls: session.pollHistory,
  };
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function drawHeader(sh: Sheet, session: Session, st: Stats): void {
  sh.page.drawRectangle({ x: MARGIN, y: sh.y - 2, width: 28, height: 3, color: NAVY });
  sh.y -= 16;
  sh.text('Lecture React', { size: 8.5, bold: true, color: MUTED });
  sh.y -= 24;
  sh.text('Class report', { size: 24, bold: true, color: NAVY });
  sh.y -= 18;
  sh.text(dateLong(st.startedAt), { size: 11 });
  sh.y -= 15;
  sh.text(
    `${clock(st.startedAt)} – ${clock(st.endedAt)}  ·  ${duration(st.endedAt - st.startedAt)}  ·  class code ${session.code}`,
    { size: 10, color: MUTED },
  );
  sh.y -= 10;
}

function drawKpis(sh: Sheet, st: Stats): void {
  const tiles: [string, string, string][] = [
    ['Students', String(st.peakPresence), `${st.distinctStudents} joined in total`],
    ['Reactions', String(st.reactionsTotal), st.peakPresence ? `${(st.reactionsTotal / st.peakPresence).toFixed(1)} per student` : ''],
    ['Questions', String(st.questions.length), `${st.answered} answered · ${st.questions.length - st.answered} open`],
    ['Checks', String(st.polls.length), st.polls.length ? `${st.polls.filter((p) => p.kind === 'understanding').length} understanding` : 'none run'],
  ];
  const gap = 10;
  const w = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
  const h = 64;
  sh.ensure(h + 12);
  sh.y -= h + 8;
  tiles.forEach(([label, value, sub], i) => {
    const x = MARGIN + i * (w + gap);
    sh.page.drawRectangle({ x, y: sh.y, width: w, height: h, color: TILE, borderColor: RULE, borderWidth: 0.6 });
    sh.page.drawText(label, { x: x + 10, y: sh.y + h - 16, size: 7.5, font: sh.bold, color: MUTED });
    sh.page.drawText(value, { x: x + 10, y: sh.y + 20, size: 22, font: sh.bold, color: NAVY });
    sh.page.drawText(sub, { x: x + 10, y: sh.y + 8, size: 7.5, font: sh.regular, color: MUTED });
  });
}

/**
 * The class as a timeline: one stacked bar per bucket of reactions, the
 * presence line over it, and a tick for every understanding check. This is
 * the chart that answers "when did they stop following".
 */
function drawTimeline(sh: Sheet, session: Session, st: Stats): void {
  sh.heading('The room over time');
  const span = Math.max(60_000, st.endedAt - st.startedAt);
  // ≤ 60 buckets so a three-hour lecture is still a bar chart, not a barcode.
  const bucketMs = [60_000, 120_000, 300_000, 600_000].find((b) => span / b <= 60) ?? 900_000;
  const buckets = Math.max(1, Math.ceil(span / bucketMs));
  const bucketOf = (at: number) => Math.min(buckets - 1, Math.max(0, Math.floor((at - st.startedAt) / bucketMs)));

  const stacks: Record<Signal, number>[] = Array.from({ length: buckets }, () => ({ following: 0, struggling: 0, fault: 0 }));
  for (const s of session.reactionLog) stacks[bucketOf(s.at)]![SIGNAL_OF[s.type]] += s.count;
  const tallest = stacks.reduce((m, b) => Math.max(m, b.following + b.struggling + b.fault), 0);

  const chartH = 150;
  const axisLeft = 30;
  const plotX = MARGIN + axisLeft;
  const plotW = CONTENT_W - axisLeft - 30;
  sh.ensure(chartH + 60);
  sh.y -= chartH + 16;
  const base = sh.y;

  if (st.reactionsTotal === 0 && st.peakPresence === 0) {
    sh.page.drawText('Nothing was recorded during this class.', { x: plotX, y: base + chartH / 2, size: 10, font: sh.regular, color: MUTED });
    sh.y -= 30;
    return;
  }

  // Gridlines and the left axis (reactions per bucket).
  const yMax = Math.max(1, tallest);
  for (let i = 0; i <= 4; i++) {
    const y = base + (chartH * i) / 4;
    sh.page.drawLine({ start: { x: plotX, y }, end: { x: plotX + plotW, y }, thickness: 0.5, color: RULE });
    const v = String(Math.round((yMax * i) / 4));
    sh.page.drawText(v, { x: plotX - 6 - sh.regular.widthOfTextAtSize(v, 7), y: y - 2.5, size: 7, font: sh.regular, color: MUTED });
  }

  // Bars.
  const slot = plotW / buckets;
  const barW = Math.max(2, slot * 0.7);
  stacks.forEach((b, i) => {
    let y = base;
    const x = plotX + i * slot + (slot - barW) / 2;
    for (const sig of ['following', 'struggling', 'fault'] as Signal[]) {
      const h = (b[sig] / yMax) * chartH;
      if (h <= 0) continue;
      sh.page.drawRectangle({ x, y, width: barW, height: h, color: SIGNAL_COLOR[sig] });
      y += h;
    }
  });

  // Presence line, right axis, drawn as a step so a join shows where it happened.
  const pMax = Math.max(1, st.peakPresence);
  const px = (at: number) => plotX + Math.min(1, Math.max(0, (at - st.startedAt) / span)) * plotW;
  const py = (n: number) => base + (n / pMax) * chartH;
  const samples = [{ at: st.startedAt, count: 0 }, ...session.presenceLog];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    const nextAt = samples[i + 1]?.at ?? st.endedAt;
    sh.page.drawLine({ start: { x: px(a.at), y: py(a.count) }, end: { x: px(nextAt), y: py(a.count) }, thickness: 1.4, color: NAVY });
    if (samples[i + 1]) {
      sh.page.drawLine({ start: { x: px(nextAt), y: py(a.count) }, end: { x: px(nextAt), y: py(samples[i + 1]!.count) }, thickness: 1.4, color: NAVY });
    }
  }
  for (let i = 0; i <= 2; i++) {
    const v = String(Math.round((pMax * i) / 2));
    sh.page.drawText(v, { x: plotX + plotW + 6, y: base + (chartH * i) / 2 - 2.5, size: 7, font: sh.regular, color: MUTED });
  }

  // A tick per poll, on the time axis.
  for (const poll of st.polls) {
    const x = px(poll.createdAt);
    sh.page.drawLine({ start: { x, y: base - 2 }, end: { x, y: base + chartH }, thickness: 0.8, color: MUTED, dashArray: [2, 2] });
    sh.page.drawText('▲', { x: x - 3, y: base - 12, size: 7, font: sh.regular, color: INK });
  }

  // Time axis: a label every few buckets.
  const every = Math.max(1, Math.ceil(buckets / 8));
  for (let i = 0; i < buckets; i += every) {
    const at = st.startedAt + i * bucketMs;
    const label = `+${Math.round((i * bucketMs) / 60_000)}m`;
    sh.page.drawText(label, { x: plotX + i * slot, y: base - 12, size: 7, font: sh.regular, color: MUTED });
  }
  sh.page.drawText(clock(st.startedAt), { x: plotX, y: base - 22, size: 7, font: sh.regular, color: MUTED });
  const endLabel = clock(st.endedAt);
  sh.page.drawText(endLabel, { x: plotX + plotW - sh.regular.widthOfTextAtSize(endLabel, 7), y: base - 22, size: 7, font: sh.regular, color: MUTED });

  // Legend.
  sh.y = base - 38;
  let lx = MARGIN;
  const legend: [RGB, string][] = [
    [SIGNAL_COLOR.following, SIGNAL_LABEL.following],
    [SIGNAL_COLOR.struggling, SIGNAL_LABEL.struggling],
    [SIGNAL_COLOR.fault, SIGNAL_LABEL.fault],
  ];
  for (const [c, label] of legend) {
    sh.page.drawRectangle({ x: lx, y: sh.y - 1, width: 8, height: 8, color: c });
    sh.page.drawText(label, { x: lx + 12, y: sh.y, size: 7.5, font: sh.regular, color: INK });
    lx += 12 + sh.regular.widthOfTextAtSize(label, 7.5) + 14;
  }
  sh.y -= 12;
  sh.page.drawLine({ start: { x: MARGIN, y: sh.y + 3 }, end: { x: MARGIN + 14, y: sh.y + 3 }, thickness: 1.4, color: NAVY });
  sh.page.drawText(`Students connected (right axis, peak ${st.peakPresence})`, { x: MARGIN + 18, y: sh.y, size: 7.5, font: sh.regular, color: INK });
  if (st.polls.length) {
    const lx2 = MARGIN + 18 + sh.regular.widthOfTextAtSize(`Students connected (right axis, peak ${st.peakPresence})`, 7.5) + 14;
    sh.page.drawText('▲ understanding check / poll', { x: lx2, y: sh.y, size: 7.5, font: sh.regular, color: INK });
  }
  sh.y -= 6;
}

function drawReactionBreakdown(sh: Sheet, st: Stats): void {
  sh.heading('Reactions');
  if (st.reactionsTotal === 0) {
    sh.paragraph('No reactions were sent.', { color: MUTED });
    return;
  }
  const rows = [...REACTION_TYPES]
    .map((t) => ({ type: t, n: st.byType.get(t) ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const labelW = 74;
  const numW = 64;
  const barW = CONTENT_W - labelW - numW;
  const rowH = 17;
  sh.ensure(rows.length * rowH + 10);
  sh.y -= 6;
  for (const r of rows) {
    sh.y -= rowH;
    const meta = REACTION_META[r.type];
    sh.page.drawText(meta.label, { x: MARGIN, y: sh.y + 4, size: 9, font: isFaultType(r.type) ? sh.regular : sh.bold, color: INK });
    sh.page.drawRectangle({ x: MARGIN + labelW, y: sh.y + 1, width: barW, height: 12, color: TRACK });
    const w = (r.n / st.reactionsTotal) * barW;
    if (w > 0) sh.page.drawRectangle({ x: MARGIN + labelW, y: sh.y + 1, width: w, height: 12, color: ACCENT[meta.accent] });
    const num = `${r.n}  ·  ${pct(r.n, st.reactionsTotal)}%`;
    sh.page.drawText(num, { x: MARGIN + labelW + barW + 8, y: sh.y + 4, size: 8.5, font: sh.regular, color: INK });
  }
  sh.y -= 4;
}

function drawPolls(sh: Sheet, st: Stats): void {
  sh.heading('Understanding checks and polls');
  if (st.polls.length === 0) {
    sh.paragraph('No understanding check was run.', { color: MUTED });
    return;
  }
  st.polls.forEach((poll, i) => {
    const n = poll.responses.size;
    const counts = new Map<string, number>();
    for (const optionId of poll.responses.values()) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    sh.ensure(40 + poll.options.length * 16);
    sh.y -= 18;
    const when = `+${elapsed(st.startedAt, poll.createdAt)}  ·  ${clock(poll.createdAt)}`;
    sh.text(`${i + 1}.`, { size: 9, bold: true, color: MUTED });
    sh.paragraph(poll.kind === 'understanding' ? 'Understanding check' : poll.question, { x: MARGIN + 16, w: CONTENT_W - 16 - 110, size: 10.5, bold: true, lead: 0 });
    sh.page.drawText(when, { x: A4.w - MARGIN - sh.regular.widthOfTextAtSize(when, 8), y: sh.y, size: 8, font: sh.regular, color: MUTED });
    sh.y -= 4;
    const labelW = 120;
    const numW = 70;
    const barW = CONTENT_W - 16 - labelW - numW;
    for (const opt of poll.options) {
      sh.ensure(16);
      sh.y -= 15;
      const c = counts.get(opt.id) ?? 0;
      sh.page.drawText(opt.label, { x: MARGIN + 16, y: sh.y + 3, size: 8.5, font: sh.regular, color: INK });
      sh.page.drawRectangle({ x: MARGIN + 16 + labelW, y: sh.y, width: barW, height: 11, color: TRACK });
      const w = n ? (c / n) * barW : 0;
      if (w > 0) sh.page.drawRectangle({ x: MARGIN + 16 + labelW, y: sh.y, width: w, height: 11, color: ACCENT[pollAccent(poll, opt.id)] });
      sh.page.drawText(`${pct(c, n)}%  (${c})`, { x: MARGIN + 16 + labelW + barW + 8, y: sh.y + 3, size: 8, font: sh.regular, color: INK });
    }
    sh.y -= 12;
    sh.text(`${n} of ${st.peakPresence || n} answered`, { x: MARGIN + 16, size: 8, color: MUTED });
  });
}

function pollAccent(poll: Poll, optionId: string): PaletteKey {
  if (poll.kind === 'understanding') {
    return optionId === 'got_it' ? 'mint' : optionId === 'almost' ? 'yellow' : 'pink';
  }
  const order: PaletteKey[] = ['sky', 'lavender', 'mint', 'yellow'];
  return order[poll.options.findIndex((o) => o.id === optionId) % order.length] ?? 'sky';
}

function drawQuestions(sh: Sheet, st: Stats): void {
  sh.heading(`Questions (${st.questions.length}, most voted first)`);
  if (st.questions.length === 0) {
    sh.paragraph('No questions were asked.', { color: MUTED });
    return;
  }
  const gutter = 60;
  for (const q of st.questions) {
    sh.ensure(46);
    sh.y -= 16;
    const top = sh.y;
    sh.text(`${q.votes} ${q.votes === 1 ? 'vote' : 'votes'}`, { size: 9, bold: true, color: NAVY });
    sh.page.drawText(`+${elapsed(st.startedAt, q.createdAt)}`, { x: MARGIN, y: top - 11, size: 7, font: sh.regular, color: MUTED });
    sh.y = top + 11;
    sh.paragraph(q.text, { x: MARGIN + gutter, w: CONTENT_W - gutter, size: 10, lead: 13.5 });
    sh.y -= 12;
    const status =
      q.status === 'resolved' && q.resolvedAt
        ? `Answered at +${elapsed(st.startedAt, q.resolvedAt)}`
        : 'Not answered during class';
    sh.page.drawRectangle({
      x: MARGIN + gutter, y: sh.y - 2, width: sh.regular.widthOfTextAtSize(status, 7.5) + 10, height: 12,
      color: q.status === 'resolved' ? hex('#E3F1EC') : hex('#FBEFD9'),
    });
    sh.page.drawText(status, { x: MARGIN + gutter + 5, y: sh.y + 1, size: 7.5, font: sh.regular, color: q.status === 'resolved' ? hex('#2F6B5C') : hex('#8A5A12') });
    sh.y -= 6;
    sh.page.drawLine({ start: { x: MARGIN, y: sh.y - 4 }, end: { x: A4.w - MARGIN, y: sh.y - 4 }, thickness: 0.5, color: RULE });
    sh.y -= 4;
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
  drawTimeline(sh, session, st);
  drawReactionBreakdown(sh, st);
  drawPolls(sh, st);
  drawQuestions(sh, st);
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
