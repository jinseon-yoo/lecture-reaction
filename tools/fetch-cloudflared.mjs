#!/usr/bin/env node
/**
 * Fetches the `cloudflared` binary the outbound tunnel runs.
 *
 * The tunnel is what makes the app usable in a hall where the lectern's
 * Ethernet and the students' Wi-Fi are routed apart (see
 * `packages/server/src/tunnel.ts`). It needs one executable, which Cloudflare
 * publishes per platform on GitHub — so this fetches and caches it the same
 * way `build-server-binary.mjs` fetches an official Node.
 *
 * Two callers:
 *   - a developer, once:  `pnpm cloudflared`   -> tools/.cache/cloudflared
 *   - the packaging scripts, with `--out`, to place it beside the app binary.
 *
 * Both land somewhere `resolveCloudflared()` already looks, so nothing has to
 * be configured after it runs.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO } from './platform.mjs';

/**
 * `latest` rather than a pinned tag, deliberately.
 *
 * A quick tunnel talks to Cloudflare's current edge, and an old client is the
 * usual cause of a tunnel that negotiates forever and then fails — which, in
 * this app, happens in front of a lecture theatre. Reproducible builds matter
 * less than that; `LR_CLOUDFLARED_VERSION=2024.8.2` pins it when they do.
 */
const VERSION = process.env.LR_CLOUDFLARED_VERSION?.trim() || 'latest';

/** Rust target triple -> the asset Cloudflare publishes for it. */
const ASSETS = {
  'x86_64-pc-windows-msvc': { asset: 'cloudflared-windows-amd64.exe', archive: false },
  'aarch64-pc-windows-msvc': { asset: 'cloudflared-windows-arm64.exe', archive: false },
  'aarch64-apple-darwin': { asset: 'cloudflared-darwin-arm64.tgz', archive: true },
  'x86_64-apple-darwin': { asset: 'cloudflared-darwin-amd64.tgz', archive: true },
  'x86_64-unknown-linux-gnu': { asset: 'cloudflared-linux-amd64', archive: false },
  'aarch64-unknown-linux-gnu': { asset: 'cloudflared-linux-arm64', archive: false },
};

/** The triple for the machine this is running on, when none is given. */
function hostTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`;
  throw new Error(`Unsupported platform for cloudflared: ${process.platform}`);
}

function releaseUrl(asset) {
  return VERSION === 'latest'
    ? `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`
    : `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset}`;
}

/**
 * Downloads cloudflared for `triple` into `outDir` and returns its path.
 *
 * Re-downloads rather than trusting an existing file only when `force` is set;
 * the packaging scripts call this on every build and a ~35 MB fetch per build
 * is not worth it.
 */
export async function fetchCloudflared(triple = hostTriple(), outDir = join(REPO, 'tools/.cache'), force = false) {
  const entry = ASSETS[triple];
  if (!entry) throw new Error(`No cloudflared build for ${triple}`);

  const windows = triple.includes('windows');
  const target = join(outDir, windows ? 'cloudflared.exe' : 'cloudflared');
  if (!force && existsSync(target)) return target;

  mkdirSync(outDir, { recursive: true });
  const url = releaseUrl(entry.asset);
  console.log(`      fetching ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`cloudflared download failed: HTTP ${response.status} (${url})`);
  const bytes = Buffer.from(await response.arrayBuffer());

  if (entry.archive) {
    // The macOS assets are a tarball holding a single `cloudflared`.
    const archive = join(outDir, entry.asset);
    writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', outDir], { stdio: 'inherit' });
    rmSync(archive, { force: true });
  } else {
    rmSync(target, { force: true });
    writeFileSync(target, bytes);
  }

  if (!existsSync(target)) throw new Error(`cloudflared was not produced at ${target}`);
  if (!windows) chmodSync(target, 0o755);
  return target;
}

/**
 * Puts cloudflared where Tauri's `externalBin` expects a sidecar:
 * `apps/overlay/src-tauri/binaries/cloudflared-<triple>[.exe]`, the same
 * convention `build-server-binary.mjs` follows for `lr-server`. Tauri strips
 * the triple when it copies the file into the bundle, so at runtime it sits
 * beside `lr-server` as plain `cloudflared` — which is the first place
 * `resolveCloudflared()` looks.
 */
export async function stageCloudflaredSidecar(triple) {
  const windows = triple.includes('windows');
  const fetched = await fetchCloudflared(triple, join(REPO, 'tools/.cache', `cloudflared-${triple}`));
  const binaries = join(REPO, 'apps/overlay/src-tauri/binaries');
  mkdirSync(binaries, { recursive: true });
  const staged = join(binaries, `cloudflared-${triple}${windows ? '.exe' : ''}`);
  rmSync(staged, { force: true });
  copyFileSync(fetched, staged);
  if (!windows) chmodSync(staged, 0o755);
  return staged;
}

/* Run directly: `node tools/fetch-cloudflared.mjs [--target <triple>] [--out <dir>]` */
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const triple = arg('--target') ?? process.env.LR_BUILD_TARGET ?? hostTriple();
  const outDir = arg('--out') ? resolve(arg('--out')) : join(REPO, 'tools/.cache');
  const path = await fetchCloudflared(triple, outDir, process.argv.includes('--force'));
  console.log(`cloudflared (${triple}): ${path}`);
}
