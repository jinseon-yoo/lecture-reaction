/**
 * An outbound tunnel, for the rooms where the LAN is not an option.
 *
 * The default topology assumes a phone can open a socket to the professor's
 * machine. On a lot of campuses it cannot: the lectern is on wired Ethernet in
 * a staff VLAN, the students are on a guest Wi-Fi SSID, and the two are routed
 * apart on purpose. No firewall rule on the laptop changes that — there is no
 * path between the two networks at all, so `lan.ts` can pick a perfectly
 * correct address that is still unreachable from every seat in the room.
 *
 * The way out is to stop asking for an inbound path. `cloudflared` dials *out*
 * from this machine to Cloudflare's edge and holds the connection open;
 * students reach a public `https://<random>.trycloudflare.com` hostname that
 * proxies back down it. Both sides only ever make outbound connections, which
 * is the one thing every campus network permits.
 *
 * Deliberate properties of this choice:
 *
 *   - **No account, no hosting, no bill.** Quick tunnels need no Cloudflare
 *     login and cost nothing. Running our own relay would mean a VPS, a
 *     domain, TLS renewal and somebody paying for it every month.
 *   - **The server stays here.** Sessions, questions and poll answers still
 *     live in this process on the professor's machine, exactly as before. The
 *     tunnel moves bytes; it does not move the source of truth.
 *   - **HTTPS falls out for free.** The public hostname is TLS-terminated, so
 *     the student page is served over `https:` and `resolveSocketUrl()` picks
 *     `wss:` on its own. No certificate to install anywhere.
 *
 * And the costs, stated plainly:
 *
 *   - The hostname is random and changes every time the tunnel starts. The QR
 *     is regenerated per class anyway, so this is survivable, but a link
 *     pasted into an LMS last week is dead this week.
 *   - Quick tunnels are best-effort with no SLA; Cloudflare says as much.
 *   - Reactions round-trip through a Cloudflare edge instead of the room's
 *     switch. That is tens of milliseconds, not sub-50ms LAN latency, which is
 *     why this is a fallback the professor turns on and not the default.
 *   - Question text transits Cloudflare. Nothing is stored there, but it is no
 *     longer true that the data never leaves the building.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export type TunnelStatus = 'off' | 'starting' | 'up' | 'failed';

export interface TunnelState {
  status: TunnelStatus;
  /** The public origin students open, e.g. `https://x-y-z.trycloudflare.com`. */
  url: string | null;
  /** Why it is `failed`, in words a professor can act on. */
  error: string | null;
}

/** How long cloudflared gets to hand us a hostname before we call it failed. */
const STARTUP_TIMEOUT_MS = 30_000;
/** Backoff after the child dies unexpectedly, so a flapping edge is not a spin. */
const RESTART_DELAY_MS = 2_000;
/** Give up rather than reconnect forever in front of a class. */
const MAX_RESTARTS = 3;

/**
 * cloudflared prints the hostname inside an ASCII box on stderr, and the exact
 * banner has changed between releases. Matching the URL itself rather than the
 * surrounding decoration keeps this working across versions.
 */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/**
 * Where to find the binary, in order of how deliberate the choice is.
 *
 *   1. `LECTURE_CLOUDFLARED` — an explicit path always wins.
 *   2. Next to this executable. In the packaged app the server is a Node SEA
 *      binary, so `process.execPath` is `lr-server` itself and its directory is
 *      the app folder where the bundled `cloudflared` sits beside it.
 *   3. `tools/.cache` in the repo, where the dev-time fetch script puts it.
 *   4. `PATH`, for a professor who already has it installed.
 *
 * Returns null when there is nothing to run, which the caller reports as a
 * setup problem rather than a crash.
 */
export function resolveCloudflared(): string | null {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

  const override = process.env.LECTURE_CLOUDFLARED?.trim();
  if (override) return existsSync(override) ? resolve(override) : null;

  const beside = join(dirname(process.execPath), exe);
  if (existsSync(beside)) return beside;

  // `import.meta.url` does not survive the CJS bundle the SEA build produces,
  // so this branch only ever resolves in a source run — which is exactly when
  // the repo cache is the right place to look.
  try {
    const repoCache = resolve(dirname(new URL(import.meta.url).pathname), '../../../tools/.cache', exe);
    if (existsSync(repoCache)) return repoCache;
  } catch {
    /* packaged build: no source tree to look in */
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export class Tunnel {
  #status: TunnelStatus = 'off';
  #url: string | null = null;
  #error: string | null = null;

  #child: ChildProcess | null = null;
  #startupTimer: NodeJS.Timeout | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #restarts = 0;
  /** Set by `stop()` so an expected exit is not treated as a failure. */
  #stopping = false;

  constructor(private readonly port: number) {}

  get state(): TunnelState {
    return { status: this.#status, url: this.#url, error: this.#error };
  }

  /**
   * Brings the tunnel up. Idempotent: calling it while starting or already up
   * is a no-op, so the launcher can poll without racing itself.
   */
  start(): TunnelState {
    if (this.#status === 'starting' || this.#status === 'up') return this.state;

    const binary = resolveCloudflared();
    if (!binary) {
      return this.fail(
        'cloudflared is not installed. Put the binary beside the app, or set LECTURE_CLOUDFLARED.',
      );
    }

    this.#stopping = false;
    this.#restarts = 0;
    this.#error = null;
    this.spawnChild(binary);
    return this.state;
  }

  /** Takes it down and stays down until `start()` is called again. */
  stop(): TunnelState {
    this.#stopping = true;
    this.clearTimers();
    this.killChild();
    this.#status = 'off';
    this.#url = null;
    this.#error = null;
    return this.state;
  }

  /** Called from the process signal handlers; must not throw. */
  dispose(): void {
    try {
      this.stop();
    } catch {
      /* shutting down anyway */
    }
  }

  /* ---------------------------------------------------------------- */

  private spawnChild(binary: string): void {
    this.#status = 'starting';
    this.#url = null;

    const args = [
      'tunnel',
      '--url', `http://127.0.0.1:${this.port}`,
      // A quick tunnel would otherwise check for a new release on every run,
      // which adds seconds to a start the professor is watching.
      '--no-autoupdate',
      // Quick tunnels are noisy at the default level and we only ever read the
      // hostname out of the stream.
      '--loglevel', 'info',
    ];

    // cloudflared prefers QUIC, which is UDP/7844 — a port plenty of campus
    // firewalls drop outright while allowing ordinary TLS. It does fall back on
    // its own, but the fallback costs a timeout the professor is standing
    // through, so allow forcing http2 up front.
    const protocol = process.env.LECTURE_TUNNEL_PROTOCOL?.trim();
    if (protocol) args.push('--protocol', protocol);

    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // Detached would outlive us and hold the tunnel open after the class.
        detached: false,
        windowsHide: true,
      });
    } catch (err) {
      this.fail(`could not start cloudflared: ${String(err)}`);
      return;
    }
    this.#child = child;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    // The hostname has appeared on stdout in some versions and stderr in
    // others; watch both rather than depending on which.
    child.stdout?.on('data', (chunk: string) => this.scan(chunk));
    child.stderr?.on('data', (chunk: string) => this.scan(chunk));

    child.on('error', (err) => {
      if (this.#stopping) return;
      this.fail(`cloudflared failed to run: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = null;
      if (this.#stopping) return;
      this.handleUnexpectedExit(binary, code, signal);
    });

    this.clearTimer('startup');
    this.#startupTimer = setTimeout(() => {
      if (this.#status !== 'starting') return;
      this.fail(
        'cloudflared did not return a public address within 30s. ' +
          'The network may be blocking it — try LECTURE_TUNNEL_PROTOCOL=http2.',
      );
    }, STARTUP_TIMEOUT_MS);
    this.#startupTimer.unref?.();
  }

  /** Watches the child's output for the hostname it was started to obtain. */
  private scan(chunk: string): void {
    if (this.#url) return;
    const match = QUICK_TUNNEL_URL.exec(chunk);
    if (!match) return;

    this.#url = match[0];
    this.#status = 'up';
    this.#error = null;
    this.clearTimer('startup');
    console.log(`[lecture-react] tunnel up: students open ${this.#url}`);
  }

  /**
   * The edge dropped us, or cloudflared crashed. A class is in progress, so
   * retry a couple of times before admitting defeat — but not forever, because
   * a silently retrying tunnel looks identical to a working one from the
   * launcher and the professor needs to know to switch back to the LAN URL.
   */
  private handleUnexpectedExit(binary: string, code: number | null, signal: string | null): void {
    const how = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;

    if (this.#restarts >= MAX_RESTARTS) {
      this.fail(`cloudflared kept stopping (${how}). Fall back to the local address.`);
      return;
    }

    this.#restarts += 1;
    this.#status = 'starting';
    this.#url = null;
    console.warn(
      `[lecture-react] tunnel stopped (${how}); restart ${this.#restarts}/${MAX_RESTARTS}`,
    );

    this.clearTimer('restart');
    this.#restartTimer = setTimeout(() => this.spawnChild(binary), RESTART_DELAY_MS);
    this.#restartTimer.unref?.();
  }

  private fail(message: string): TunnelState {
    this.clearTimers();
    this.killChild();
    this.#status = 'failed';
    this.#url = null;
    this.#error = message;
    console.error(`[lecture-react] tunnel failed: ${message}`);
    return this.state;
  }

  private killChild(): void {
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null) return;
    child.kill();
    // cloudflared normally leaves promptly; SIGKILL is the backstop so quitting
    // the app never leaves an orphan holding the tunnel open.
    const hard = setTimeout(() => child.kill('SIGKILL'), 2_000);
    hard.unref?.();
    child.once('exit', () => clearTimeout(hard));
  }

  private clearTimer(which: 'startup' | 'restart'): void {
    const timer = which === 'startup' ? this.#startupTimer : this.#restartTimer;
    if (timer) clearTimeout(timer);
    if (which === 'startup') this.#startupTimer = null;
    else this.#restartTimer = null;
  }

  private clearTimers(): void {
    this.clearTimer('startup');
    this.clearTimer('restart');
  }
}
