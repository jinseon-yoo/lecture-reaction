/**
 * Lecture React realtime server.
 *
 * One process serves three things:
 *   - a tiny JSON API (`/health`, `/api/session/:code`, `/api/join-url`,
 *     `/api/tunnel`)
 *   - the built student web app (apps/student/dist) with SPA fallback
 *   - the websocket hub at `/ws?role=professor|student`
 *
 * Students reach it one of two ways: directly over the room's LAN (the
 * default, and the fast path), or through an outbound tunnel for the rooms
 * where the lectern and the seats are on networks that cannot route to each
 * other. See `tunnel.ts` for why that second path exists.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { normalizeCode } from '@lr/shared';
import { Hub, type Role } from './hub.js';
import { StaticSite } from './static.js';
import { lanAddress, rankLanCandidates } from './lan.js';
import { Tunnel } from './tunnel.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '0.0.0.0';

/**
 * Where the built student app lives.
 *
 * In the repo this is resolved relative to this file. Inside the packaged
 * desktop app there is no source tree — and no `import.meta.url`, since the
 * bundle is CommonJS — so the host passes the path in instead.
 */
const STUDENT_DIST = process.env.LECTURE_STUDENT_DIST
  ? resolve(process.env.LECTURE_STUDENT_DIST)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/student/dist');

const hub = new Hub();
const site = new StaticSite(STUDENT_DIST);
const tunnel = new Tunnel(PORT);

/**
 * True when this request arrived through the tunnel rather than from the
 * room's LAN or this machine.
 *
 * Loopback is not the test it looks like: `cloudflared` runs on this same
 * machine and proxies to `127.0.0.1`, so a student on the other side of the
 * world arrives with the same `remoteAddress` as the overlay does. What does
 * separate them is that Cloudflare stamps every proxied request with its own
 * headers, and nothing on the LAN path sets them.
 */
function viaTunnel(req: IncomingMessage): boolean {
  return Boolean(req.headers['cf-ray'] ?? req.headers['cf-connecting-ip']);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const httpServer = createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch (err) {
    console.error('[http] request failed:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal error');
  }
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // `DELETE /api/tunnel` is not a "simple" cross-origin request, so the
  // overlay's webview asks permission before it sends one.
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }

  if (pathname === '/health') {
    return json(res, 200, { ok: true, activeSessions: hub.store.activeSessionCount() });
  }

  // Everything below is the professor's own control surface: it reports the
  // machine's interface list and starts and stops processes. None of it should
  // answer the public internet just because a tunnel is open.
  if (pathname === '/api/join-url' || pathname === '/api/tunnel') {
    if (viaTunnel(req)) return json(res, 404, { error: 'not_found' });
  }

  if (pathname === '/api/join-url') {
    // Recomputed per request, never cached: the professor may join the room's
    // Wi-Fi after the server started, or move rooms between classes.
    const lanIp = lanAddress();
    const host = lanIp ?? 'localhost';
    return json(res, 200, {
      url: `http://${host}:${PORT}/`,
      wsUrl: `ws://${host}:${PORT}/ws`,
      lanIp,
      port: PORT,
      /** Every reachable-looking address, best first — for diagnostics and manual override. */
      candidates: rankLanCandidates(),
      /**
       * The tunnel is reported alongside the LAN address rather than replacing
       * it. Which one the class should use is the professor's call — the
       * launcher offers both — and silently swapping the URL behind a QR code
       * that is already on the projector would strand whoever scanned it.
       */
      tunnel: tunnel.state,
    });
  }

  if (pathname === '/api/tunnel') {
    // Started on demand, not at boot: most rooms never need it, it takes a few
    // seconds, and a quick tunnel burns a hostname every time it runs.
    if (req.method === 'POST') return json(res, 200, tunnel.start());
    if (req.method === 'DELETE') return json(res, 200, tunnel.stop());
    if (req.method === 'GET' || req.method === 'HEAD') return json(res, 200, tunnel.state);
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (pathname.startsWith('/api/session/')) {
    // Fast pre-check for the student page. Leaks nothing but existence/status.
    const code = normalizeCode(decodeURIComponent(pathname.slice('/api/session/'.length)));
    const session = code ? hub.store.getByCode(code) : undefined;
    if (!session) return json(res, 200, { exists: false, status: 'unknown' });
    return json(res, 200, { exists: session.status === 'active', status: session.status });
  }

  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

  site.serve(req, res, pathname);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // The overlay and the student app may be served from a Vite dev origin.
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

/* ------------------------------------------------------------------ */
/* WebSocket upgrade                                                   */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const roleParam = url.searchParams.get('role');
  if (roleParam !== 'professor' && roleParam !== 'student') {
    socket.destroy();
    return;
  }
  // The professor socket is the one that can create and end classes. On the
  // LAN it is reachable only from the room; a tunnel would publish it to the
  // internet, so that role is refused to anything arriving through one. The
  // overlay always connects over loopback and is unaffected.
  //
  // This is not the only thing standing between a stranger and a class — the
  // per-session `token` in hub.ts already stops a takeover, and a fresh
  // `session:create` only ever yields the caller their own empty session — but
  // there is no reason to let a random visitor mint sessions and burn codes.
  if (roleParam === 'professor' && viaTunnel(req)) {
    socket.destroy();
    return;
  }
  const role: Role = roleParam;
  wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, role));
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

httpServer.listen(PORT, HOST, () => {
  const lan = lanAddress();
  const candidates = rankLanCandidates();
  console.log(`[lecture-react] listening on http://${HOST}:${PORT}`);
  console.log(`[lecture-react] local:    http://localhost:${PORT}`);
  if (lan) {
    console.log(`[lecture-react] students open: http://${lan}:${PORT}`);
  } else {
    console.log('[lecture-react] no LAN address found — phones may not be able to connect.');
  }
  // Show what was rejected and why: on a machine with VM bridges or a VPN the
  // automatic pick is the difference between a working class and a dead URL.
  if (candidates.length > 1) {
    console.log('[lecture-react] other addresses seen (not chosen):');
    for (const c of candidates.slice(1)) {
      console.log(`[lecture-react]   ${c.iface} ${c.address} — ${c.note}`);
    }
    console.log('[lecture-react] override with LECTURE_LAN_IP=<address> if the pick is wrong.');
  }
  console.log(
    site.available
      ? `[lecture-react] serving student app from ${STUDENT_DIST}`
      : '[lecture-react] student app not built yet (apps/student/dist missing)',
  );

  // Opened at boot, not on demand, and this is the default.
  //
  // "Everyone is on the same Wi-Fi" sounds like it should be the easy case,
  // and it is the case this tool was originally built for. It is also the case
  // that fails most often, because campus and guest access points routinely
  // enable **client isolation**: every device gets internet, and no device can
  // talk to any other device on the same SSID. The professor's laptop and the
  // students' phones are then one hop apart and completely unable to reach
  // each other, and nothing on this machine can tell that in advance — the LAN
  // address is correct, pingable from the laptop itself, and dead from a seat.
  //
  // There is no way to negotiate around it either. The student's browser
  // cannot probe the LAN address from a page served over the tunnel (mixed
  // content), and cannot fall back to the tunnel from a LAN page that never
  // loaded. Whichever address goes in the QR code is the only one the class
  // gets. So it has to be the one that works on both kinds of network.
  //
  // Starting it here rather than when the professor clicks means it is
  // negotiated and ready long before anyone looks at a QR code.
  if (process.env.LECTURE_TUNNEL !== '0') {
    tunnel.start();
  } else {
    console.log('[lecture-react] LECTURE_TUNNEL=0 — local network only');
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[lecture-react] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  // Log and keep serving: one bad frame must not end the class.
  console.error('[lecture-react] uncaught exception:', err);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[lecture-react] ${signal} — shutting down`);
    // Before the hub, so a slow teardown never leaves cloudflared holding a
    // public hostname open after the class is over.
    tunnel.dispose();
    hub.dispose();
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
