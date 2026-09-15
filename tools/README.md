# tools

## make-icon.mjs

Regenerates the app icon source from a hand-placed 32x32 pixel grid, so the
icon stays editable as pixel art rather than an opaque binary. No image
library: it scales the grid 32x and writes the PNG with `node:zlib`.

```sh
node tools/make-icon.mjs tools/icon-src.png
cd apps/overlay && pnpm exec tauri icon ../../tools/icon-src.png
```

The second command regenerates every platform size into
`apps/overlay/src-tauri/icons/`, which `tauri::generate_context!` requires at
compile time — a missing `32x32.png` fails the Rust build, not the JS build.

## build-macos-app.mjs

Packages the movable macOS app: `pnpm build:macos:app`.

```sh
pnpm build:macos:app   # -> dist/Lecture-React-macOS-Universal{,.zip}
```

It builds **one app per architecture**, not a universal one. Three details are
load-bearing:

- No universal build, ever. A universal app needs a universal sidecar, and the Node
  SEA server is ~110 MB thin / ~220 MB fat. macOS never finishes validating the fat
  one on a GUI launch: the app hangs in `_dyld_start` with no window, no server and
  no crash report. Thin sidecars launch fine. `build-server-binary.mjs` now refuses
  `universal-apple-darwin` outright so this cannot come back by accident.
- Either Mac builds both architectures: the SEA blob is not architecture-locked, so
  it drops into whichever official node is fetched for the target.
- Tauri leaves the bundle unsigned and Apple Silicon refuses to run unsigned code, so
  the finished bundle is re-signed ad hoc. That is enough to launch; it is not
  notarization, and a downloaded copy still needs its quarantine flag cleared.
- The archive is built with `ditto`, not `zip`. Only `ditto` keeps the bundle's
  symlinks and executable bits intact, and a mangled `.app` will not launch.

## fetch-cloudflared.mjs

Downloads the `cloudflared` binary that the outbound tunnel runs
(`packages/server/src/tunnel.ts`): `pnpm cloudflared`.

```sh
pnpm cloudflared                                   # -> tools/.cache/cloudflared (this machine)
node tools/fetch-cloudflared.mjs --target x86_64-pc-windows-msvc --out some/dir
```

The packaging scripts do not call the CLI; they import `stageCloudflaredSidecar(triple)`,
which fetches the per-target build into `tools/.cache/cloudflared-<triple>/` and copies it to
`apps/overlay/src-tauri/binaries/cloudflared-<triple>[.exe]` — the sidecar convention Tauri's
`externalBin` expects, the same one `build-server-binary.mjs` follows for `lr-server`. Tauri
drops the triple when it copies the file into the bundle, so at runtime it sits beside
`lr-server` as plain `cloudflared`, which is the first place the server looks.

It fetches `latest` rather than a pinned release, deliberately: an old client is the usual
cause of a quick tunnel that negotiates forever and then fails, and here that happens in
front of a lecture theatre. `LR_CLOUDFLARED_VERSION=2025.x.y` pins it when reproducibility
matters more.

The macOS build signs `cloudflared` with the same Developer ID as `lr-server` — it ships
signed by Cloudflare, but notarization wants every nested executable under the app's own
identity — and the `lipo -archs` check covers it, since a fat sidecar is the launch hang
described above.
