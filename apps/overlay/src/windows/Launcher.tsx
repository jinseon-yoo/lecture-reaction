import { useCallback, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faQrcode, faCheck, faLink, faGlobe, faWifi } from '@fortawesome/free-solid-svg-icons';
import { useSession } from '../lib/SessionContext';
import {
  allowFirewall,
  firewallStatus,
  hideLauncher,
  isDesktop,
  showOverlay,
  type FirewallStatus,
} from '../lib/desktop';
import {
  fetchJoinInfo,
  fetchSessionStatus,
  joinUrl,
  startTunnel,
  stopTunnel,
  type JoinInfo,
} from '../lib/server';
import { QrCanvas } from '../components/QrCanvas';

/**
 * How often the launcher re-asks the server which address students should use.
 * Cheap (a local request) and worth it: a professor who joins the room's Wi-Fi
 * after opening the app would otherwise show the class a dead QR code.
 */
const JOIN_URL_POLL_MS = 10_000;

/**
 * While the tunnel is coming up there is a professor watching a spinner, so
 * the same poll runs much faster until it settles.
 */
const TUNNEL_POLL_MS = 1_500;

/**
 * The small ordinary window: start the class, share the code, launch the
 * overlay. Once the overlay is up this window steps out of the way — and drops
 * its socket, so the server only ever holds one professor connection.
 */
export function Launcher() {
  const { state, startClass, disconnect, reset } = useSession();
  const [joinInfo, setJoinInfo] = useState<JoinInfo | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [ended, setEnded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [firewall, setFirewall] = useState<FirewallStatus>({ supported: false, allowed: true });
  const [fixingFirewall, setFixingFirewall] = useState(false);
  const [firewallError, setFirewallError] = useState<string | null>(null);

  // The QR must encode an address a phone can reach, which is the server's LAN
  // address — not localhost. Falls back to VITE_SERVER_URL's origin.
  //
  // Re-checked continuously rather than once on mount: the professor often
  // opens the app in an office and only joins the lecture hall's Wi-Fi on the
  // way in, which changes the address students need. Polling keeps the QR and
  // the printed URL correct without anyone restarting anything.
  useEffect(() => {
    let controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;

    // Self-scheduling rather than a fixed interval: the cadence depends on the
    // answer. A tunnel that is still negotiating is worth asking about every
    // second and a half; a settled address is not.
    const refresh = () => {
      controller.abort();
      controller = new AbortController();
      void fetchJoinInfo(controller.signal).then((info) => {
        if (cancelled) return;
        setJoinInfo(info);
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(
          refresh,
          info.tunnel.status === 'starting' ? TUNNEL_POLL_MS : JOIN_URL_POLL_MS,
        );
      });
    };

    refresh();

    // A network change shows up immediately rather than on the next tick.
    const onOnline = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The QR can encode a perfectly correct address that no phone can open,
  // because Windows drops inbound connections on a Public network profile —
  // which is what a school Wi-Fi almost always is. Re-checked when the window
  // is looked at again, so allowing the rule from Windows' own prompt (or from
  // the button below) clears the notice without a restart.
  useEffect(() => {
    const check = () => void firewallStatus().then(setFirewall);
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  const onAllowFirewall = useCallback(() => {
    setFixingFirewall(true);
    setFirewallError(null);
    void allowFirewall()
      .catch((err: unknown) => setFirewallError(String(err)))
      .finally(() => {
        setFixingFirewall(false);
        void firewallStatus().then(setFirewall);
      });
  }, []);

  // Handed off: no socket, so poll the server when this window comes back into
  // view to notice that the class was ended from the overlay.
  useEffect(() => {
    const code = state.code;
    if (!handedOff || !code) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchSessionStatus(code).then((result) => {
        if (result && (!result.exists || result.status === 'ended')) {
          setHandedOff(false);
          setStarting(false);
          reset();
          setEnded(true);
        }
      });
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [handedOff, state.code, reset]);

  const classEnded = ended || state.status === 'ended';

  const copyText = useCallback((text: string, which: 'link' | 'code') => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1400);
  }, []);

  const tunnel = joinInfo?.tunnel ?? { status: 'off' as const, url: null, error: null };
  const tunnelOn = tunnel.status === 'up' || tunnel.status === 'starting';
  /** Held back until the address is settled, so the QR is never swapped mid-class. */
  const addressPending = joinInfo?.pending ?? false;

  /** The full invite: address + code, so a student needs only to click it. */
  const shareUrl =
    joinInfo && state.code && !addressPending ? joinUrl(joinInfo.shareBase) : null;

  /**
   * Switches between the two ways in.
   *
   * The default is the internet address, because it is the only one that works
   * regardless of whether the room's access point lets its clients talk to
   * each other. This turns it off in favour of the local address, which is
   * faster and keeps the traffic in the building — worth having when the
   * professor knows the network allows it.
   */
  const onToggleTunnel = useCallback(() => {
    setTunnelBusy(true);
    const request = tunnelOn ? stopTunnel() : startTunnel();
    void request
      .then((next) => setJoinInfo((prev) => (prev ? { ...prev, tunnel: next } : prev)))
      .finally(() => {
        setTunnelBusy(false);
        void fetchJoinInfo().then(setJoinInfo);
      });
  }, [tunnelOn]);

  const onStartOverlay = useCallback(() => {
    if (isDesktop()) {
      void showOverlay().then(() => hideLauncher());
    } else {
      // Browser review mode: the overlay is just another tab.
      window.open(`${window.location.pathname}?window=overlay`, '_blank', 'noopener');
    }
    setHandedOff(true);
    disconnect();
  }, [disconnect]);

  const onStart = useCallback(() => {
    setEnded(false);
    setStarting(true);
    startClass();
  }, [startClass]);

  return (
    /* The window is sized to fit every state without scrolling. `min-h-full`
       rather than `h-full` so that when something does grow past it — a long
       tunnel hostname, the firewall notice and the QR all at once on a short
       laptop screen — the overflow scrolls instead of being clipped out of
       reach, which a centred `h-full` flex column would do silently. */
    <main className="h-full w-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-5 px-6 py-7 text-center select-none">
      <h1 className="lr-pixel text-[15px] tracking-[0.22em]">LECTURE REACT</h1>

      {classEnded ? (
        <>
          <p className="lr-pixel text-[11px] text-(--lr-muted)">CLASS ENDED</p>
          <button type="button" className="lr-btn lr-btn-primary lr-btn-lg" onClick={onStart}>
            [ START CLASS ]
          </button>
        </>
      ) : state.status !== 'active' ? (
        <>
          <button
            type="button"
            className="lr-btn lr-btn-primary lr-btn-lg"
            onClick={onStart}
            disabled={starting}
          >
            [ START CLASS ]
          </button>
          {starting && (
            <span className="lr-pixel text-[10px] text-(--lr-muted) flex items-center gap-2">
              <span className="lr-loader">
                <i />
                <i />
                <i />
              </span>
              starting…
            </span>
          )}
          {state.lastError && (
            <p className="lr-text text-[11px] text-(--lr-muted)">{state.lastError}</p>
          )}
        </>
      ) : (
        <>
          <div className="lr-code" aria-label={`Class code ${state.code ?? ''}`}>
            {state.code}
          </div>

          {showQr && shareUrl ? (
            <QrCanvas value={shareUrl} />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="lr-btn"
                  onClick={() => shareUrl && copyText(shareUrl, 'link')}
                  disabled={!shareUrl}
                  title={shareUrl ?? 'Working out the address students should use…'}
                >
                  <FontAwesomeIcon icon={copied === 'link' ? faCheck : faLink} className="mr-2" />
                  {copied === 'link' ? 'Copied' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  className="lr-btn"
                  onClick={() => state.code && copyText(state.code, 'code')}
                >
                  <FontAwesomeIcon icon={copied === 'code' ? faCheck : faCopy} className="mr-2" />
                  {copied === 'code' ? 'Copied' : 'Copy Code'}
                </button>
                <button
                  type="button"
                  className="lr-btn"
                  onClick={() => setShowQr(true)}
                  disabled={!shareUrl}
                >
                  <FontAwesomeIcon icon={faQrcode} className="mr-2" />
                  Show QR
                </button>
              </div>

              {/* Shown so it is obvious what "Copy Link" put on the clipboard,
                  and so the address can be read out if someone cannot scan. */}
              {shareUrl && (
                <p className="lr-text max-w-[300px] break-all text-[10px] text-(--lr-muted)">
                  {shareUrl}
                </p>
              )}

              {addressPending && (
                <span className="lr-pixel text-[10px] text-(--lr-muted) flex items-center gap-2">
                  <span className="lr-loader">
                    <i />
                    <i />
                    <i />
                  </span>
                  preparing the join address…
                </span>
              )}
            </div>
          )}

          {showQr && (
            <button type="button" className="lr-btn lr-btn-ghost" onClick={() => setShowQr(false)}>
              Hide QR
            </button>
          )}

          {/* Only while the local address is the one being handed out. The
              firewall rule governs *inbound* connections, and the default join
              address needs none — the tunnel dials out. Warning about it
              anyway sends a professor chasing a UAC prompt, on a machine they
              may not have rights to, to fix something that is not broken. */}
          {firewall.supported && !firewall.allowed && tunnel.status !== 'up' && (
            <div className="flex max-w-[300px] flex-col items-center gap-1.5">
              <p className="lr-text text-center text-[10px] text-(--lr-muted)">
                Windows Firewall is blocking student connections to this computer.
                The local address will time out until it is allowed.
              </p>
              <button
                type="button"
                className="lr-btn"
                onClick={onAllowFirewall}
                disabled={fixingFirewall}
              >
                {fixingFirewall ? 'Waiting for Windows…' : 'Allow Students Through'}
              </button>
              {firewallError && (
                <p className="lr-text text-center text-[10px] text-(--lr-muted)">
                  {firewallError}
                </p>
              )}
            </div>
          )}

          {/* Being on the same Wi-Fi is not the same as being able to reach
              each other: campus access points routinely block client-to-client
              traffic, and nothing here can detect that in advance. So the
              address that works either way is the default, and the local one —
              faster, and it keeps the traffic in the building — is the choice
              the professor makes when they know the network allows it. */}
          <div className="flex max-w-[300px] flex-col items-center gap-1.5">
            <button
              type="button"
              className="lr-btn"
              onClick={onToggleTunnel}
              disabled={tunnelBusy || tunnel.status === 'starting'}
            >
              <FontAwesomeIcon icon={tunnelOn ? faWifi : faGlobe} className="mr-2" />
              {tunnelOn ? 'Use This Wi-Fi Instead' : 'Use Any Network'}
            </button>

            <p className="lr-text max-w-[300px] text-center text-[10px] text-(--lr-muted)">
              {tunnel.status === 'up'
                ? 'Students join over the internet, so a phone works whether or not this Wi-Fi lets devices see each other. Switch to this Wi-Fi only if you have tested that a phone on it can load the page.'
                : tunnel.status === 'failed'
                  ? `Internet route unavailable, so students must be on a network that can reach this computer. ${tunnel.error ?? ''}`
                  : tunnel.status === 'starting'
                    ? 'Working out the address students should use. A few seconds.'
                    : 'Students must be on this same Wi-Fi, and it must allow devices to reach each other. Test with one phone before the class.'}
            </p>
          </div>

          <p className="lr-pixel text-[10px] text-(--lr-muted)">
            {state.presence} student{state.presence === 1 ? '' : 's'} joined
          </p>

          <button type="button" className="lr-btn lr-btn-primary" onClick={onStartOverlay}>
            [ Start Overlay ]
          </button>
        </>
      )}
      </div>
    </main>
  );
}
