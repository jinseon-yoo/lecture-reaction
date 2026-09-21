/** Where the realtime server lives, and how students reach it. */

// Numeric loopback: `localhost` can resolve to ::1 first and reach a different process.
const DEFAULT_ORIGIN = 'http://127.0.0.1:8787';

export function serverOrigin(): string {
  const raw = import.meta.env.VITE_SERVER_URL ?? DEFAULT_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** `http(s)://host` -> `ws(s)://host/ws?role=professor`. */
export function professorSocketUrl(origin = serverOrigin()): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '?role=professor';
  return url.toString();
}

/**
 * The URL a student types or scans. It deliberately carries no class code:
 * the link gets them to the join form, and the code they type is what admits
 * them. Anyone who can see the QR would otherwise be in without it.
 */
export function joinUrl(base: string): string {
  return new URL(base).toString();
}

export type TunnelStatus = 'off' | 'starting' | 'up' | 'failed';

export interface TunnelState {
  status: TunnelStatus;
  /** The public origin students open, once the tunnel has one. */
  url: string | null;
  error: string | null;
}

interface JoinUrlResponse {
  url: string;
  wsUrl: string;
  lanIp: string | null;
  port: number;
  tunnel: TunnelState;
}

export interface JoinInfo {
  /** The room-network address: fastest, and dead if the Wi-Fi isolates clients. */
  lanUrl: string;
  lanIp: string | null;
  tunnel: TunnelState;
  /** Whichever of the two the class should actually be given. */
  shareBase: string;
  /**
   * True while the join address is still being decided.
   *
   * The tunnel takes a few seconds to negotiate at startup. Showing the LAN
   * address during that window and then swapping it is the one thing that
   * must not happen: the QR is on the projector by then, and whoever scanned
   * it early is on an address that is no longer the one being handed out.
   */
  pending: boolean;
}

const TUNNEL_OFF: TunnelState = { status: 'off', url: null, error: null };

/**
 * Everything the launcher needs to decide what to put on the projector.
 *
 * If the endpoint is missing or unreachable we fall back to the configured
 * origin, which is still correct when everyone is on the same machine.
 */
export async function fetchJoinInfo(signal?: AbortSignal): Promise<JoinInfo> {
  const origin = serverOrigin();
  const offline: JoinInfo = {
    lanUrl: origin,
    lanIp: null,
    tunnel: TUNNEL_OFF,
    shareBase: origin,
    pending: false,
  };
  try {
    const res = await fetch(`${origin}/api/join-url`, { signal });
    if (!res.ok) return offline;
    const data = (await res.json()) as Partial<JoinUrlResponse>;
    const lanUrl = typeof data.url === 'string' && data.url.length > 0 ? data.url : origin;
    const tunnel = data.tunnel ?? TUNNEL_OFF;
    return {
      lanUrl,
      lanIp: data.lanIp ?? null,
      tunnel,
      // A live tunnel wins outright, and it is on by default. The LAN address
      // only works if the access point lets two of its own clients talk to
      // each other, which a campus network routinely does not; the tunnel
      // works either way. Handing out the one that might be dead, when a
      // working one is right there, is not a trade worth making for latency
      // nobody can perceive in a reaction that floats for three seconds.
      shareBase: tunnel.status === 'up' && tunnel.url ? `${tunnel.url}/` : lanUrl,
      pending: tunnel.status === 'starting',
    };
  } catch {
    return offline;
  }
}

/**
 * The address to hand the class, and nothing else.
 *
 * Kept as its own export because the overlay's gear menu wants only this —
 * it has no toggle and no status to render, so it should not have to know
 * that tunnels exist at all.
 */
export async function fetchJoinBase(signal?: AbortSignal): Promise<string> {
  return (await fetchJoinInfo(signal)).shareBase;
}

/** Brings the outbound tunnel up. Safe to call when it is already running. */
export async function startTunnel(): Promise<TunnelState> {
  return tunnelRequest('POST');
}

export async function stopTunnel(): Promise<TunnelState> {
  return tunnelRequest('DELETE');
}

async function tunnelRequest(method: 'POST' | 'DELETE'): Promise<TunnelState> {
  try {
    const res = await fetch(`${serverOrigin()}/api/tunnel`, { method });
    if (!res.ok) {
      return { status: 'failed', url: null, error: `server returned ${res.status}` };
    }
    return (await res.json()) as TunnelState;
  } catch (err) {
    return { status: 'failed', url: null, error: String(err) };
  }
}

interface SessionLookup {
  exists: boolean;
  status: 'active' | 'ended';
}

/**
 * Used by the launcher after it hands the class to the overlay: it has no
 * socket any more, so it asks the server whether the class is still running.
 */
export async function fetchSessionStatus(code: string): Promise<SessionLookup | null> {
  try {
    const res = await fetch(`${serverOrigin()}/api/session/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SessionLookup>;
    if (typeof data.exists !== 'boolean') return null;
    return { exists: data.exists, status: data.status === 'ended' ? 'ended' : 'active' };
  } catch {
    return null;
  }
}
