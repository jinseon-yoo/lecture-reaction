// Builds a report from a synthetic 50-minute class — no server, no sockets —
// so the PDF can be checked without sitting through a lecture. Writes the file
// and prints its path; `--render` also rasterises every page next to it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReportPdf } from '../src/report.ts';
import { Store } from '../src/store.ts';

const out = process.argv[2] ?? join(process.cwd(), 'test-output');
mkdirSync(out, { recursive: true });

const store = new Store();
const start = Date.parse('2026-09-22T10:00:00');
const session = store.createSession(start);
const at = (min, sec = 0) => start + min * 60_000 + sec * 1000;

// 26 students trickle in over the first eight minutes; a few leave near the end.
for (let i = 0; i < 26; i++) store.joinParticipant(session, `s${i}`, at(0, i * 18));
for (let i = 0; i <= 26; i += 4) {
  for (let j = 0; j < Math.min(i, 26); j++) store.setPresence(session, `s${j}`, true);
  store.samplePresence(session, at(0, i * 18));
}
store.samplePresence(session, at(8));
for (const j of [23, 24, 25]) store.setPresence(session, `s${j}`, false);
store.samplePresence(session, at(46));

// The arc of a lecture: attentive, then a rough patch around minute 20-26,
// a re-explanation that lands, and fatigue at the end.
const burst = (min, type, n) => store.recordBurst(session, type, n, at(min, Math.floor(Math.random() * 50)));
for (let m = 2; m < 50; m++) {
  const rough = m >= 20 && m <= 26;
  const tired = m >= 44;
  burst(m, 'understand', rough ? 1 : tired ? 2 : 4 + (m % 3));
  if (m % 4 === 0) burst(m, 'interesting', 2);
  if (m % 7 === 0) burst(m, 'love', 3);
  if (rough) { burst(m, 'confused', 6 + (m % 4)); burst(m, 'too_fast', 4); if (m === 23) burst(m, 'again', 9); }
  if (tired) burst(m, 'too_fast', 2);
}
burst(11, 'cant_hear', 3);
burst(12, 'cant_hear', 2);

// Questions, some answered, some not — Korean and English, one with a URL.
const q = (min, anon, text, votes, resolvedMin) => {
  const r = store.addQuestion(session, anon, text, at(min));
  for (let v = 1; v < votes; v++) store.voteQuestion(session, `s${(v * 7) % 26}`, r.question.id);
  if (resolvedMin) store.resolveQuestion(session, r.question.id, at(resolvedMin));
};
q(9, 's3', 'Why does the step size have to shrink for convergence? Does a constant step size ever work in practice?', 14, 15);
q(21, 's8', '왜 이 알고리즘의 시간복잡도가 n 제곱인지 잘 이해가 안 됩니다. 다시 한번 설명해주실 수 있을까요?', 17, 27);
q(22, 's11', 'Can you go back to the slide with the Lipschitz constant?', 9, 24);
q(30, 's14', 'Is this related to https://en.wikipedia.org/wiki/Gradient_descent#Momentum or is momentum a separate topic?', 4);
q(38, 's2', 'Will the proof be on the exam?', 11);
q(47, 's19', 'What is the difference between batch and stochastic here?', 3);

// Two understanding checks and a custom poll.
const poll = (min, kind, question, options, answers, endMin) => {
  const p = store.startPoll(session, kind, question, options, at(min));
  answers.forEach((optId, i) => store.answerPoll(session, `s${i}`, p.id, optId));
  store.endPoll(session, p.id, at(endMin));
};
const U = [{ id: 'got_it', label: 'Got it' }, { id: 'almost', label: 'Almost' }, { id: 'lost', label: 'Lost' }];
poll(18, 'understanding', '', U, [...Array(12).fill('got_it'), ...Array(6).fill('almost'), ...Array(4).fill('lost')], 19);
poll(28, 'understanding', '', U, [...Array(18).fill('got_it'), ...Array(4).fill('almost'), ...Array(1).fill('lost')], 29);
poll(40, 'custom', 'Which topic should the next session revisit first?', [
  { id: 'a', label: 'Convergence proof' }, { id: 'b', label: 'Momentum' }, { id: 'c', label: 'Stochastic GD' },
], [...Array(9).fill('a'), ...Array(5).fill('b'), ...Array(7).fill('c')], 41);

const end = at(50);
store.endSession(session, end);

const t0 = Date.now();
const bytes = await buildReportPdf(session, end);
const file = join(out, `report-${session.code}.pdf`);
writeFileSync(file, bytes);
console.log(`${file}  ${(bytes.length / 1024).toFixed(0)} KB in ${Date.now() - t0} ms`);

if (process.argv.includes('--render')) {
  execFileSync('pdftoppm', ['-png', '-r', '80', file, join(out, 'page')]);
  console.log('rendered pages to', out);
}
