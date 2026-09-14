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
