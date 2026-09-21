# Lecture React

A professor is mid-slide and has no idea half the room stopped following two minutes ago.
Lecture React is a transparent overlay that floats that signal over whatever they are already
presenting.

The professor runs a click-through desktop window on top of PowerPoint, Keynote, a PDF, a
browser, an IDE — anything. Students open a URL on their phone/ipad/laptop, type a 5-character class code,
and tap: *understand*, *confused*, *too fast*, *again*, *interesting*, *love it* — plus
*can't see* and *can't hear* for when the projector washes out or the mic is off. Reactions
float up over the slides. Questions stack as compact bubbles down the right edge, sorted by
votes; the professor clears them with a checkmark and can fire a one-click understanding check,
then blow the result up in the middle of the screen for the whole room to read.

No student install. No login on either side. No dashboard — the overlay **is** the professor
interface, and nobody ever looks away from the slides.

## Download and run on Windows

Open [GitHub Releases](https://github.com/jenna-studio/lecture-reaction/releases)
and choose a release with `Lecture-React-Windows-x64-Portable.zip` attached.
Windows testing builds are marked **Pre-release**. If no ZIP is listed yet, it
has not been uploaded; maintainers can use the [release instructions](#publish-a-github-release-without-actions) below.

1. Download the ZIP and **extract the entire folder** onto your desktop or a
   writable USB drive. Do not run the app from inside the ZIP preview.
2. Open **Lecture React.exe**. Keep `lr-server.exe`, `cloudflared.exe`, `student/`,
   and `portable.txt` beside it.
3. Connect the presentation computer and students to the same reachable network.
   When Windows Firewall asks, tick **both Private and Public** and allow access.
4. Start a class and share its QR code or join link. The address is an internet
   address by default, so it works from any network the phones are on — see
   [why](#why-the-join-address-is-an-internet-address-by-default). If students
   scan it and the page will not load, see [Students scan the QR and nothing
   loads](#students-scan-the-qr-and-nothing-loads).
5. Quit the app before safely ejecting the USB drive.

Requires **64-bit Windows 10/11** and
[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
The current ZIP does not include WebView2. No app installation, Node.js, pnpm,
or Rust is needed on the presentation computer. Managed computers may block
unsigned apps, USB executables, or incoming network connections.

The portable edition is configured to keep settings and browser storage in a
`Data/` folder beside the executable. Active classes and questions are held in
memory and end when the app closes; moving the USB drive does not move a live class.
The Windows binaries have been built and packaged, but execution on a Windows PC
and the PowerPoint overlay still need testing.

### Windows testing checklist

- Open the app, start a class, and join from a phone on the same network.
- Press **Students On Another Network**, wait for the QR to change to an
  `https://….trycloudflare.com` address, and join from a phone on **cellular
  data** (Wi-Fi off). This is the path a split campus network forces.
- Send reactions and questions, vote on a question, and resolve it in the overlay.
- Run a PowerPoint slideshow and check visibility and click-through outside the
  app controls. `Ctrl+Shift+L` toggles Interaction Mode.
- Change a setting, quit, and reopen to check persistence. For USB testing, repeat
  from the USB folder and confirm that `Data/` is created there.
- Quit and reopen to check that the bundled server shuts down cleanly.

Report the Windows version, whether the app ran from desktop or USB, and any
exact error message or screenshot. Share the ZIP through a download link if an
email provider rejects its size or executable contents.

## Download and run on macOS

Open [GitHub Releases](https://github.com/jenna-studio/lecture-reaction/releases)
and pick the archive for your Mac: `Lecture-React-macOS-AppleSilicon.zip` for an
M-series Mac, `Lecture-React-macOS-Intel.zip` for an Intel one. (Apple menu ->
About This Mac tells you which.) Each holds a single self-contained app: unzip it
and drag **Lecture React.app** wherever you want it — Applications, the Desktop,
an external drive. Nothing is installed, and no Node, pnpm, or Rust is needed on
the presentation Mac.

1. Unzip the archive and move **Lecture React.app** where you want it.
2. **Before the first open, clear the download flag.** The app is signed ad hoc and
   is *not* notarized by Apple, so macOS blocks a downloaded copy — `spctl` rejects
   it and the app never starts. In Terminal, type `xattr -dr com.apple.quarantine `
   (with a trailing space), drag the app onto the window, and press Return. Then
   open it normally. Once is enough; this is not needed on every launch.
3. **Right-click → Open no longer works for this.** Apple removed that bypass in
   macOS 15. If you already tried to open the app and macOS refused, use System
   Settings → Privacy & Security → **Open Anyway**, near the bottom of the page.
4. Allow incoming connections when macOS asks — students connect to this Mac.
5. Start a class and share its QR code or join link. Students scan it and then type
   the class code; the link by itself does not admit anyone.

The only way to make a plain double-click work for everyone is to sign with a
**Developer ID Application** certificate and notarize the app with Apple. That needs
a paid Apple Developer account; an *Apple Distribution* certificate is for the App
Store and will not do it.

There is deliberately no universal build. A universal app needs a universal server
sidecar, and at ~220 MB macOS never finishes validating it on launch: the app sits in
`dyld` with no window, no server and no crash report, forever. Thin per-architecture
sidecars launch normally, and each download is less than half the size.

The first launch can take 10-30 seconds while macOS checks the app; later launches are
quick. Settings live in your home folder rather than inside the bundle, so copying the app
to another Mac starts it fresh. Active classes and questions are held in memory and
end when the app closes.

## What the overlay looks like

```
 +---------------------------------------------------------------+
 |                                          [ Q ] can you redo    |
 |                                          [ 3 ] the proof?  [v] |
 |                                                                |
 |             (nothing spawns over the slide content)            |
 |                                          [ Q ] what's the      |
 |                                          [ 1 ] base case?  [v] |
 |          ^      ^                                              |
 |         ? x14   O                        ( +2 more )           |
 |     ^      ^        ^                                          |
 |    !      ? x14    O                                           |
 |                                                                |
 |  [ ABCDE ][ ? Ask Class ][ Reactions ][ * ][ End Class ][?x14] |
 +---------------------------------------------------------------+
   ^ reactions rise from the bottom band (Left / Both are options)
     the right-hand strip is reserved for questions
     a surge highlights the strip and names itself -----^
     the class code and controls sit in the corner
```

Everything you see is drawn on a transparent, always-on-top window. Clicks pass straight through
to the slides underneath — except over the controls, the question cards and the checkmarks.

## The reactions

Six feelings in a 3x2 grid, and two fault reports on their own row beneath it.

| Reaction | Meaning | Icon | Colour |
| --- | --- | --- | --- |
| **Understand** | I understand this. | `fa-check` | mint |
| **Confused** | I'm confused. | `fa-question` | peach |
| **Too Fast** | You're going too fast. | `fa-forward` | sky |
| **Love It** | I love this. | `fa-heart` | pink |
| **Again** | Please explain that again. | `fa-rotate-left` | lavender |
| **Interesting** | This is interesting. | `fa-lightbulb` | yellow |
| **Can't See** | I can't see the screen. | `fa-eye-slash` | aqua |
| **Can't Hear** | I can't hear you. | `fa-volume-xmark` | sage |

Every reaction has its own hue — the original five pastels could not cover eight without
repeats, so peach, sage and aqua were added at roughly 25deg, 85deg and 185deg.

The last two are the odd ones out on purpose. Everything above them is a feeling; these are
facts you can fix in seconds, and they are **separate because the fixes are different** — a
washed-out projector and a dead microphone are not the same problem. They sit apart from the
sentiment grid, they **stay visible in Quiet Mode** when sentiment is hidden, and they raise a
surge from just two students, because if two people cannot hear then nobody in the back row
can.

All eight are defined once in `REACTION_META` in `packages/shared`; the server, the student app
and the overlay all derive from it, so adding or changing one is a single edit.

## Repo layout

```
lecture-reaction/
├── packages/
│   ├── shared/      protocol.ts (wire types + LIMITS + REACTION_META),
│   │                code.ts (class-code generation/normalisation),
│   │                theme.css (retro pixel design tokens)
│   └── server/      Node 20 + ws realtime server; also serves the student app
│       │            tunnel.ts drives the outbound cloudflared tunnel
│       └── test/        smoke.mjs, simulate-class.mjs, lan.mjs
├── apps/
│   ├── student/     Vite + React web app — what students open on their phone
│   └── overlay/     Tauri v2 + React — the professor's desktop overlay
│       └── src-tauri/   Rust shell: transparent window, click-through, sidecar
│           ├── schemas/     vendored tauri.conf.json schema (editor only)
│           └── binaries/    the server and cloudflared sidecars (built, gitignored)
├── tools/           dev-desktop.mjs (port-resolving launcher), free-ports.mjs,
│                    build-server-binary.mjs, fetch-cloudflared.mjs, make-icon.mjs
├── .vscode/         hides target/ and caches from the tree and search
└── docs/
    └── ARCHITECTURE.md
```

pnpm workspaces. `packages/shared` is the single source of truth for the wire protocol and the
design tokens; all three other packages depend on it, so a protocol change breaks the typecheck
on every side in the same commit.

## Prerequisites

- **Node 20+** and **pnpm** — required for everything.
- **Rust toolchain + Tauri v2 system prerequisites** — required only for `apps/overlay`
  (the desktop app). Follow https://tauri.app/start/prerequisites/ for your platform:
  macOS needs Xcode Command Line Tools; Linux needs the WebKitGTK and build packages; Windows
  needs the MSVC build tools and WebView2.

If you are only working on the server or the student app, you can skip Rust entirely and use
`pnpm dev:web`.

## Running it

```bash
pnpm install     # once

pnpm desktop     # ← run the actual product: realtime server + professor desktop app
```

`pnpm desktop` is the one you want. It starts the realtime server *and* the Tauri
desktop app together, which matters: `pnpm tauri dev` on its own launches the
overlay with no server to talk to, and it will sit there failing to connect.

The other modes:

```bash
pnpm dev         # server + student app + overlay in a BROWSER (no Rust needed)
pnpm dev:web     # server + student app only
pnpm tauri dev   # desktop app alone — only useful if a server is already running
```

Ports:

| Port (default) | What |
| --- | --- |
| `8787` | Realtime server — WebSocket endpoint and the student app over HTTP |
| `5173` | Vite dev server for `apps/student` |
| `5174` | Vite dev server for the overlay webview, which Tauri loads |

These are defaults, not requirements: if another project already holds one, `pnpm desktop`
picks the next free port and wires everything to it (details just below).

The server works out the address students should use **every time it is asked**, so it
follows whatever network you are on. See [Getting students in](#getting-students-in).

All three dev commands run `tools/free-ports.mjs` first, which reclaims ports `8787`/
`5173`/`5174` and stops leftover overlay instances — but **only processes belonging to
this checkout**. Anything else holding a port is left alone and named.

`pnpm desktop` then goes further: if another project already owns a port, it steps to
the next free one and threads the choice through to everything that needs it — the
server's `PORT`, the overlay's `LR_OVERLAY_PORT`, `VITE_SERVER_URL`, and Tauri's
`devUrl` (overridden for that run only). You never have to stop your other work.

| Variable | Default | Sets |
| --- | --- | --- |
| `PORT` | `8787` | the realtime server |
| `LR_OVERLAY_PORT` | `5174` | the overlay's vite dev server (Tauri loads this) |
| `LR_STUDENT_PORT` | `5173` | the student app's vite dev server (not strict — vite may take the next one) |

A port is only considered free when it can be bound on **both** `127.0.0.1` and `::1`.
Checking IPv4 alone is a trap that this codebase already fell into once: another
project's vite bound to `[::1]:5174` left `0.0.0.0:5174` bindable, both servers came
up on the same number, and because `localhost` resolves to `::1` first on macOS, the
Tauri window loaded the *other* project. For the same reason every internal URL uses
`127.0.0.1` rather than `localhost`.

Other root scripts: `pnpm build`, `pnpm typecheck`, `pnpm tauri`, `pnpm icon`,
`pnpm build:server-binary`.

### Building a double-clickable app

```bash
pnpm install
pnpm build:desktop         # builds the student app, server, and native installer
```

`pnpm tauri build` runs the same preparation automatically. The server executable
and student web assets are generated before Tauri compiles and packages the app;
no manual sidecar build is needed. `pnpm desktop` also prepares missing files on
a fresh checkout.

`pnpm build:macos:app` packages the movable macOS app described above. It builds
**one app per architecture**, signs each bundle ad hoc, and writes
`dist/Lecture-React-macOS-AppleSilicon.zip` and
`dist/Lecture-React-macOS-Intel.zip`. Each archive is made with `ditto` rather
than `zip`, because only `ditto` preserves the bundle's symlinks and executable
bits — a `.app` unpacked from a mangled archive will not launch. Building them
needs both the `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets
installed.

Deliberately not a universal build. A universal app needs a universal sidecar,
and the server sidecar is a Node SEA: roughly 110 MB thin and 220 MB fat. macOS
never finishes validating a fat binary that size on a GUI launch out of
`/Applications` — the app sits in dyld with no window, no server and no crash
report. Thin sidecars launch fine, and each download is half the size.

### Signing and notarizing the macOS app

Without notarization every downloaded copy is refused by Gatekeeper and each user
has to clear the quarantine flag by hand. To make a plain double-click work, build
with a Developer ID and let Apple notarize it. One-time setup on the build Mac:

1. **Create a Developer ID Application certificate.** In Xcode: Settings -> Accounts
   -> your team -> Manage Certificates -> **+** -> *Developer ID Application*. An
   *Apple Distribution* certificate is for the App Store and will not work here.
   Confirm with `security find-identity -v -p codesigning`.
2. **Create an App Store Connect API key** at appstoreconnect.apple.com -> Users and
   Access -> Integrations -> App Store Connect API -> Team Keys, role **Developer**.
   Download the `.p8` (only downloadable once) and note the Key ID and Issuer ID.
3. **Store the credentials** in the keychain:

   ```sh
   xcrun notarytool store-credentials lecture-react \
     --key /path/to/AuthKey_XXXXXXXX.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>
   ```

Then build with both variables set:

```sh
LR_MACOS_IDENTITY="Developer ID Application: YOUR NAME (TEAMID)" \
LR_NOTARY_PROFILE=lecture-react \
pnpm build:macos:app
```

The build signs `lr-server` first and the bundle second — signing the app seals
whatever its nested binaries look like at that moment — applies the hardened
runtime with `apps/overlay/src-tauri/entitlements.plist`, submits to Apple, waits,
staples the ticket into the `.app`, and only then makes the ZIP. A stapled app
reports *accepted, source=Notarized Developer ID* from `spctl -a -vv` and opens
with an ordinary double-click.

The entitlements are load-bearing, not boilerplate: the hardened runtime forbids
JIT, and both WKWebView and the Node-based server map executable pages. Without
them a notarized build launches and then dies as soon as either runs JavaScript.

Set neither variable and the build stays ad-hoc signed, exactly as before.

### Why a Mac will not open the app

```sh
bash tools/diagnose-macos.sh "/path/to/Lecture React.app"
```

It names the cause — wrong architecture for this Mac, an old universal build, a
quarantine flag still attached, or a broken signature — then launches the app and
reports whether a window and the bundled server actually came up.

For standard installers, build on the destination operating system: macOS produces a `.app`/`.dmg`, Windows
produces native Windows installers, and Linux produces Linux packages. Use matching
x64 or arm64 Node and Rust toolchains and install the Tauri prerequisites above.
The first server build downloads an official Node executable and needs internet
access; subsequent builds reuse the cache. A macOS app cannot run on Windows.

`build:server-binary` compiles `packages/server` into a single self-contained
executable with Node's SEA support, so the app runs on a machine with **no Node
installed**. Tauri ships it as a sidecar next to the main binary and the app starts
it on launch, skips it if a server is already listening (so `pnpm desktop` still
works), and kills it on exit so it cannot orphan port 8787. The built student app
rides along as a bundle resource.

Two things that will bite you if you touch this:

- The base `node` must contain the SEA fuse sentinel. **Homebrew's node does not** —
  postject fails with "could not find the sentinel" — so the script downloads an
  official build into `tools/.cache` and uses that.
- The SEA blob is version-locked to the node that produced it. Generating with one
  and injecting into another fails at startup with
  `v8::ToLocalChecked Empty MaybeLocal`.

### What has actually been verified

Build portability checks on 2026-09-08 (Apple Silicon macOS):

- `pnpm typecheck` and `pnpm build` passed across the workspace.
- `pnpm test:tools` passed: Windows executable selection, literal pnpm arguments,
  package entrypoint resolution, and IPv6-disabled port handling.
- `pnpm build:desktop --no-bundle` passed with automatic resource preparation.
- `pnpm tauri build --bundles app` produced `Lecture React.app`, containing the
  server executable and built student assets.
- The generated standalone server started successfully and returned HTTP 200 for
  `/health` and the student page.

Universal macOS app checks on 2026-09-12 (built on Apple Silicon), kept for the
record — the universal build was withdrawn on 2026-09-14 because the app hung at
launch from `/Applications`, and is now one app per architecture:

- `pnpm build:macos:app` produced `Lecture React.app` and its ZIP (81 MB).
- Both the app binary and the bundled server report `x86_64 arm64`, and the ad-hoc
  signature verifies with `codesign --verify --deep --strict`.
- Unpacked into an unrelated directory, the app launched **from that copy**,
  started its own bundled server, and answered HTTP 200 on `/health` and on the
  student page. Quitting it stopped the sidecar and released port 8787.
- The Intel half has not been run on an actual Intel Mac; only its architecture,
  signature and packaging are checked.

Join-gate and Gatekeeper checks on 2026-09-14 (v1.0.1, Apple Silicon, macOS 27):

- Driven through Chromium against the **packaged** `.app`, not a dev server, with a
  real class created over the professor websocket. Five checks passed: a `?c=` link
  does not enter the room, the code is not prefilled from it, the query is stripped
  from the address bar, a wrong code is refused with an inline error, and the
  correct typed code enters the room.
- The v1.0.0 macOS download was confirmed **blocked by Gatekeeper**, not broken:
  with a download's quarantine flag attached, `spctl` returns `rejected` and the app
  never launches. Clearing the flag with `xattr -dr com.apple.quarantine` *before*
  the first open makes the same bundle launch and serve normally. Clearing it after
  a blocked attempt did not reliably recover in testing, so the order matters.

Overlay checks on 2026-09-14 (v1.0.1, Chromium against the overlay window):

- A real class was started from the launcher, 14 simulated students joined and
  answered an understanding check, and the tally rendered (71/21/7, n=14).
- The results panel expanded to the centre of the screen at projector size and
  collapsed back to the corner, with the bars keeping their values across both.

macOS launch fix on 2026-09-14 (v1.0.2):

- The v1.0.0/v1.0.1 universal app **would not launch from /Applications**: the process
  sat in `_dyld_start` with a 96 KB footprint, no window, no sidecar and no crash log,
  indefinitely. Removing the 219 MB fat sidecar made it launch in 8 seconds; swapping in
  a thin 108 MB sidecar made it launch fully. That is why the build is now per-architecture.
- The per-architecture build was verified end to end: quarantined like a download, the
  flag cleared, then launched — window and bundled server up, serving `/health`.

These checks do not establish Windows/Linux runtime support or a complete desktop
class session. The Windows/Linux cases in the tooling tests simulate platform
selection; they do not run native Windows/Linux builds.

Earlier recorded checks on macOS (Node 25, pnpm 10): install, typecheck across all four packages, both web
bundles building, the Tauri shell compiling and **launching**, the server smoke test
against a live 30-student session, the standalone server binary serving with no Node
in the environment, and the student app driven end to end on phone and desktop
viewports (join from a QR link, react, ask, upvote, see a question resolved,
watch a surge fire on the overlay). Port resolution was verified against a real
clash: with another project's vite on `[::1]:5174`, `pnpm desktop` stepped to 5175,
the Tauri webview served Lecture React, and the other project was left untouched.

Not verified anywhere: the overlay's **transparency, always-on-top and click-through
behaviour over a real presentation**. The window runs, but whether it floats above a
fullscreen Keynote — macOS Spaces are the usual failure — and whether clicks reach
the app underneath is untested. That is the first thing to check, and
`CmdOrCtrl+Shift+L` is the escape hatch if the overlay ever swallows your clicks.

Also not verified: a full class session through the packaged `.app`, Windows
runtime behaviour, and native Linux builds/runtime. The Windows x64 portable
release has been cross-built and its ZIP checked; see the portable build details below.

## Keyboard shortcuts

| Shortcut | Effect |
| --- | --- |
| `CmdOrCtrl+Shift+L` | Toggle **Interaction Mode** — the whole overlay becomes clickable so you can drag panels, open the poll composer, and work through questions. Slides underneath are not clickable while this is on. Toggle it back off to keep presenting. |
| `CmdOrCtrl+Shift+H` | Toggle **Quiet Mode** — reaction floaters are suppressed and the question stack dims to a count chip. Questions keep arriving; they just stop moving in your peripheral vision. |

Both are global, so they work while PowerPoint has focus.

## Development tools

Testing a lecture tool normally needs a lecture. These stand in for one:

| Command | What it does |
| --- | --- |
| `pnpm -F @lr/server smoke` | Drives a scripted 30-student class against a running server and asserts the protocol end to end: code format, presence, burst grouping, rate limits, upvotes, poll tallies, resolve, end-of-class, and rejoin-after-end. Requires the server to already be running. |
| `pnpm -F @lr/server simulate <CODE>` | Joins 24 simulated students to a live class: posts four questions with different vote weights, answers any understanding check, and keeps reaction waves flowing. Use it to exercise the overlay without 24 phones. |
| `pnpm -F @lr/server test:lan` | Ranks synthetic macOS/Windows/Linux interface tables and asserts the right address wins in each — VM bridges, WSL, Docker and VPN adapters must all lose to the real Wi-Fi. Runs without a server. |
| `pnpm test:tools` | Tests platform selection, shell-free command arguments, package entrypoints, and IPv6-disabled port handling. |
| `pnpm build:desktop` | Builds student assets and the standalone server, then compiles and packages the desktop app for the current OS. |
| `pnpm build:server-binary` | Compiles the server into a single self-contained executable for the desktop bundle. Downloads an official node into `tools/.cache` on first run. |
| `pnpm cloudflared` | Downloads the `cloudflared` binary the outbound tunnel runs into `tools/.cache`, where a source-run server finds it. The packaging scripts fetch their own per-target copy; this one is for `pnpm dev` / `pnpm desktop`. `LECTURE_TUNNEL=1` makes a source-run server open the tunnel at boot. |
| `pnpm icon` | Regenerates the app icon from the pixel grid in `tools/make-icon.mjs` and expands it to every platform size. Tauri needs `src-tauri/icons/32x32.png` at compile time — if it is missing, the **Rust** build fails with `failed to open icon`, which looks unrelated to icons at first glance. |

One detail worth keeping: `free-ports.mjs` matches `-sTCP:LISTEN` only. A plain
`lsof -ti:5174` also lists the Tauri webview's own *connections* to the port, so
killing everything it returns kills the app you are trying to start.

To review the overlay's layout without building the desktop app, open
`http://127.0.0.1:5174/?window=launcher` (or `?window=overlay`) in a browser — use
whatever port the launcher printed if 5174 was taken.
Tauri calls are feature-detected, so the overlay renders against a placeholder
slide backdrop instead of a transparent window.

## Using it in a lecture

### Before the class

```bash
pnpm desktop
```

Two things start: the realtime server, and a small **launcher** window.

The launcher hands out an internet address by default, so students join from any
network and you do not have to know whether the room's Wi-Fi allows devices to
reach each other — see [why](#why-the-join-address-is-an-internet-address-by-default).
It needs a few seconds at startup; the QR appears once the address is settled.

### Starting the class

1. Click **START CLASS** in the launcher. A fresh 5-character code appears — `K7M4P`.
   Every class gets a new one, and the previous code dies the moment its class ends.
2. Share it, whichever way suits the room:
   - **Show QR** on the projector — the fastest way to get a hall full of phones in.
   - **Copy Link** puts `http://<address>:8787/` on your clipboard, to paste
     into the LMS, a chat, or an email. Best for students on laptops.
   - **Copy Code** copies just the five characters, if you are sharing the address
     some other way.

   The QR code and the link only carry students to the join form — neither contains
   the class code. Students type the code to get in, so keep it on screen while the
   room fills. The address is re-checked continuously, so the link and the QR stay
   correct even if you join the room's Wi-Fi after starting the app.
3. Watch `N students joined` climb. When the room is in, click **Start Overlay**.
   The launcher gets out of the way and the transparent overlay takes over.

If you would rather say it out loud than show a QR, the code deliberately contains no
`O`, `0`, `I`, `1` or `L`, so there is nothing ambiguous to say aloud — and if a
student types one of those anyway, the field ignores the keystroke rather than
accepting a code that cannot exist.

For the address, prefer your machine's Bonjour name over its IP: it does not change
when DHCP hands you a new lease, so you can say the same sentence every lecture.

```sh
scutil --get LocalHostName     # e.g. jinseon-macbook-pro -> jinseon-macbook-pro.local:8787
```

Rename the Mac (System Settings -> General -> About -> Name) to something short and it
becomes `lecture.local:8787`. Caveat: iPhones resolve `.local` reliably, **Android is
inconsistent** — treat it as a fallback for the few students whose camera will not
scan, not as the primary method.

### During the class

Present exactly as you normally would. The overlay is click-through: your slides,
your clicker and your IDE all behave as if it were not running.

| You want to | Do this |
| --- | --- |
| See how the room is doing | Nothing. Reactions rise from the bottom band. A wave of the same reaction arrives as one icon with a count (`? x 14`), not fourteen icons. |
| Answer a question | Read the cards down the right edge — newest at the bottom, most-upvoted highlighted. Click the checkmark when you have answered it; the card fades and slides away, and the student who asked sees `Answered`. |
| Ask if they are following | Click **? Ask Class**. Every phone gets *Got it / Almost / Lost*, and the tally appears on your overlay within a second. It stays up for 20 seconds, then minimizes itself. |
| Ask something specific | Alt-click (or long-press) **? Ask Class** for a quick poll composer: a question and 2-4 options. It is deliberately small — this is not a survey tool. |
| Show a question to the room | Click the **expand** arrows on a question card, just left of its checkmark. That question fills the middle of the screen at projector size, with its vote count and an Answered button. Shrink it back with the same control. |
| Show the result to the room | Click the **expand** arrows in the results panel's top-right corner. The tally pops out to the middle of the screen at projector size, so the back row can read it off the wall. Click the same button to send it back to the corner. While it is expanded it will not auto-minimize — it stays until you put it away. |
| Know when something is wrong | Watch for the control strip to highlight with a named badge (`? Confused`, `Can't Hear`). It fires when a reaction reaches ~30% of the class, so you catch a spike peripherally instead of watching floaters while you talk. |
| Hide reactions for a moment | Click **Reactions**, or press `CmdOrCtrl+Shift+H`. Reactions keep being collected and counted, they just stop moving on screen. Useful during a video, a demo, or an exam. `Can't See` / `Can't Hear` still show through — hiding a fault report would defeat the point. |
| Let a latecomer in | Open the gear menu: **Copy Link** and **Show QR** are there too, so you never have to dig the launcher back out mid-lecture. |
| Move reactions somewhere else | Gear menu -> Reaction Position: Bottom (default), Left, or Both. |
| Move the controls | Drag the strip. Click the code to collapse it down to just `[ K7M4P ]`. Both are remembered. |
| Click something on the overlay and nothing happens | Press `CmdOrCtrl+Shift+L` for Interaction Mode — the whole overlay becomes clickable. Press it again to go back to presenting. |

### Ending the class

Click **End Class** on the strip and confirm. Every student immediately gets
`Class ended. Thanks for participating.`, the code stops working, and the overlay
closes. Starting another class generates a different code; nothing carries over.

Nothing is stored. Reactions were never written down, and the questions go with the
session.

## What students see

One screen, no navigation. On a phone it is a single column; on a laptop it splits into
two, with the class's questions alongside the reaction pad instead of far below it.

```
   CLASS K7M4P  *                          [ Leave ]
   ------------------------------------------------
   HOW IS THE LECTURE GOING?

   [ v Understand ] [ ? Confused  ] [ >> Too Fast ]
   [ <3 Love It   ] [ <- Again    ] [ !  Interesting ]
   [ (x) Can't See      ] [ <x) Can't Hear         ]

   You're anonymous - your professor sees reactions,
   never who sent them.
   - - - - - - - - - - - - - - - - - - - - - - - -
   ASK A QUESTION
   [ Anything you'd like explained...             ]
                                          [ Send ]

   CLASS QUESTIONS
   [ ^17 ] Can you explain recursion again?
   [ ^9  ] Why is this O(n^2) and not O(n log n)?
```

Reactions are rate-limited to one every 2 seconds and questions to one every 15, shown
as a quiet progress bar and a "you can ask again in 12s" line rather than an error.
Students can upvote instead of asking a duplicate, and a resolved question shows
`Answered` before it leaves the list.

Anonymity is real, not cosmetic: the `anonId` in their browser is used only for
cooldowns, one-vote-per-question, and reconnecting. It never reaches a professor —
enforced by a single `toProfessorView` boundary on the server.

## Getting students in

Students open the server's address on a phone or a laptop — any device, any OS, any
browser. No app, no account, no name. The server binds all interfaces, so anything on
the same network can reach it.

Three ways to hand it out. The QR and the link reach the join form; the code is what admits them:

| | Best for |
| --- | --- |
| **Show QR** | A hall full of phones. Put it on the projector; students scan, then type the code. |
| **Copy Link** | Laptops. Pastes `http://<address>:8787/` into your LMS, a chat or an email. |
| **Copy Code** | When you are sharing the address some other way. |

All three live in the launcher, and Copy Link / Show QR are also in the overlay's gear
menu for latecomers.

The server **re-derives that address on every request**, so it tracks your
environment rather than being fixed at startup. Join the lecture hall Wi-Fi after
launching the app and the QR updates on its own within ten seconds — the launcher
re-asks continuously and also refreshes immediately on any network change.

### Choosing the right address is not trivial

A teaching laptop usually has several addresses and only one of them is reachable
from a phone in the room. On the machine this was developed on:

```
en0        10.103.85.46     real Wi-Fi          <- the one students need
bridge100  10.211.55.2      Parallels VM net    <- unreachable from a phone
bridge101  10.37.129.2      Parallels VM net    <- unreachable from a phone
```

So candidates are scored rather than taken in whatever order the OS returns them:
physical interfaces beat virtual ones, private LAN ranges beat public addresses, and
VM bridges, Docker networks, VPN tunnels and AirDrop radios are pushed to the bottom.
The boot log prints what it rejected and why, and `GET /api/join-url` returns the
full ranking.

If it still picks wrong — a room with two NICs, an unusual campus setup — override it:

```bash
LECTURE_LAN_IP=192.168.1.42 pnpm desktop
```

### When students cannot connect

Work down this list; it is roughly in order of likelihood.

1. **Are they on the same Wi-Fi?** Cellular data cannot reach your laptop. This is
   almost always the answer.
2. **Did macOS ask to allow incoming connections?** If you dismissed that prompt,
   nothing can reach the server. System Settings -> Network -> Firewall.
3. **Is the address the right one?** Check the boot log against the list above. If
   the chosen line is a `bridge`/`vmnet`/`utun` interface, use `LECTURE_LAN_IP`.
4. **The two sides cannot route to each other.** Client isolation on the room's
   Wi-Fi, or the lectern on staff Ethernet and the students on a separate SSID.
   No local address is the right address here, because there is no path. This is
   why the join address is an internet address by default — see the next
   section. If you switched to **Use This Wi-Fi Instead**, switch back.

### Why the join address is an internet address by default

Everyone being on the same Wi-Fi sounds like the easy case. It is the case that
fails most often.

Campus and guest access points routinely enable **client isolation**: every
device gets internet, and no device can talk to any other device on the same
SSID. Your laptop and a student's phone are then one hop apart and completely
unable to reach each other. The LAN address the app derives is correct, it
answers from the lectern, and it is dead from every seat in the room — and
nothing running on your machine can detect that in advance.

So the app does not try to guess. At startup it opens an *outbound* connection
from your machine to Cloudflare's edge using a bundled `cloudflared`, and hands
out a public `https://<random>.trycloudflare.com` address. Students reach that;
it is proxied back down the same connection. Nobody has to reach your computer,
so it works whether or not the access point allows it.

There is no way to negotiate this per student, either. A page served over the
tunnel cannot probe the LAN address (mixed content), and a LAN page that never
loaded cannot fall back to anything. Whichever address goes in the QR code is
the only one the class gets, so it has to be the one that works on both kinds
of network.

What that costs:

- Reactions round-trip through a Cloudflare edge instead of the room's switch:
  tens of milliseconds rather than single digits. Invisible in a reaction that
  floats for three seconds.
- Question text transits Cloudflare. Nothing is stored there, but it is no
  longer true that the data never leaves the building.
- The address is random and changes every time the app starts. Share it per
  class; a link pasted into the LMS last week is dead this week.
- It needs internet on your machine and on the phones, and a few seconds to come
  up. The launcher holds the QR back until it is ready rather than showing one
  address and then swapping it. Quick tunnels are free and unauthenticated,
  which also means best-effort with no SLA — Cloudflare says as much.

**Use This Wi-Fi Instead**, under the share buttons, switches to the local
address: faster, and the traffic stays in the building. Worth having when you
have tested that a phone on the room's Wi-Fi can actually load the page. If the
tunnel cannot start at all (no internet), the app falls back to the local
address on its own and says so.

`LECTURE_TUNNEL=0` starts the server local-only and never opens a tunnel.

While the tunnel is up the professor's own control surface — `/api/join-url`,
`/api/tunnel`, and the `role=professor` socket — refuses anything that arrived
through it. The overlay talks to the server over loopback and is unaffected;
a stranger who finds the public address gets the student page and nothing else.

If it fails to come up, the network is probably dropping UDP: `cloudflared`
prefers QUIC on `udp/7844` and falls back to HTTP/2 only after a timeout. Set
`LECTURE_TUNNEL_PROTOCOL=http2` to skip straight to the fallback. A machine
that already has `cloudflared` installed can point at it with
`LECTURE_CLOUDFLARED=/path/to/cloudflared`.

### If you are on a USB Wi-Fi adapter

A fixed classroom PC is often wired into a staff network students cannot reach,
with a USB dongle providing the Wi-Fi. That matters only for the local address,
but it used to get it wrong: Windows names a plug-in adapter after its product
(`TP-Link Wireless USB Adapter`, `Realtek 8812BU Wireless LAN 802.11ac USB NIC`),
none of which start with "Wi-Fi", so the built-in Ethernet port scored higher and
the class was handed the one address in the machine that could not work.

Adapters are now matched on the wireless keyword anywhere in the name, and
wireless outranks wired whenever a machine offers both. The two mistakes are not
symmetrical: preferring Wi-Fi when Ethernet would also have worked costs a few
milliseconds, while preferring Ethernet when it is a separate VLAN costs the
whole class. `LECTURE_LAN_IP` still overrides everything.

## Platform support

| | Server | Student app | Professor overlay |
| --- | --- | --- | --- |
| macOS | works | works | **verified running**, click-through untested over a real presentation |
| Windows | x64 executable built; runtime unverified | web build verified | x64 portable release built; runtime unverified |
| Linux | should work | works | compiles in principle, never built or run |

The server and the student app are the easy half: Node and a browser. The address
ranking is explicitly tested against Windows and Linux interface layouts
(`pnpm -F @lr/server test:lan`).

The overlay is the part that is genuinely platform-sensitive, because transparency,
always-on-top and click-through are OS window-manager features that Tauri exposes
but cannot make uniform.

**Windows.** Nothing in the Rust shell is macOS-only — the one platform-specific
detail, `Cmd` versus `Ctrl`, is `cfg`-gated, and `icon.ico` is generated. You need
the MSVC build tools and WebView2 (see [Prerequisites](#prerequisites)), then
`pnpm desktop`. The behaviour to check first is a **PowerPoint slideshow**: it takes
a topmost fullscreen window, which is exactly the thing most likely to sit above the
overlay. Presenter View on a second monitor is the usual workaround, and the overlay
does not yet choose which monitor it covers.

**Linux.** Wayland is the open question. Click-through there is a compositor-level
input-region concept rather than a window flag, so `set_ignore_cursor_events` may
not behave the same way. X11 should be closer to macOS behaviour.

The Windows x64 portable build is verified; Windows runtime behaviour and native
Linux builds remain unverified. Test on
the intended operating system and presentation setup before relying on the overlay
for a lecture.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Port 5174 is already in use` | A previous run of *this* repo left a dev server behind — cleared automatically. If another project holds it, `pnpm desktop` steps to the next port on its own; `pnpm dev` names the process and suggests `LR_OVERLAY_PORT=5175`. |
| The overlay window shows a different app | Two servers on one port number on different IP stacks, and `localhost` picked the wrong one. Fixed by dual-stack probing and `127.0.0.1` addressing; if it recurs, check `lsof -nP -iTCP:5174 -sTCP:LISTEN` for an `IPv6` row that is not yours. |
| Several overlay windows on screen | Stale app instances from earlier runs. Killing the dev servers does not stop an already-running Tauri binary. The preflight now stops them too. |
| Overlay shows an old class code | The overlay follows the session the launcher persists and re-attaches within 400ms of a new class starting. If it sticks, the launcher never wrote a new session — check that START CLASS actually got a code. |
| Desktop build reports a missing `lr-server` binary or student resources | Run `pnpm build:desktop`; its preparation hook generates both before packaging. If preparation fails, check the preceding download or toolchain error. |
| Reactions appear on the left, not the bottom | A stored preference from an earlier version. Settings are versioned and reset once, so this should self-correct; otherwise pick Bottom in the gear menu. |
| VS Code: `schema ... is untrusted` or `Missing property "permissions"` | Editor-only, never affects the build. `tauri.conf.json` points at the vendored `src-tauri/schemas/tauri-config.schema.json`; reload the window. Do not point it at `gen/schemas/desktop-schema.json` — that is the *capability* schema. |
| Rust build fails with `failed to open icon` | The icon set is missing. `pnpm icon`. Tauri reads `icons/32x32.png` at compile time, so this surfaces as a Rust error rather than an asset one. |
| Students see `Can't reach the server. Still trying...` | The server is not reachable from their phone — work through [When students cannot connect](#when-students-cannot-connect). |
| Overlay swallows clicks | `CmdOrCtrl+Shift+L` toggles Interaction Mode off. |

## Docs

`docs/ARCHITECTURE.md` covers the wire protocol message by message, the click-through mechanism
and why CSS `pointer-events` cannot do it, the two-stage reaction burst grouping, the data model
and its future Postgres shape, the privacy boundary, the design system tokens, every rate limit
and its rationale, and what is deliberately out of scope.

## Portable Windows app for a USB drive

Build a folder and ZIP for **x64 Windows 10/11**:

```bash
pnpm build:windows:portable
```

The output is `dist/Lecture-React-Windows-x64-Portable.zip`. Extract it onto a
writable USB drive and double-click `Lecture React.exe`. Keep the entire folder
together: the executable needs `lr-server.exe` and `student/` alongside it.
No Node, pnpm, Rust, or application installation is needed on the classroom PC.
The `portable.txt` marker makes both app windows use the adjacent `Data/` folder
for settings and browser storage. Quit before ejecting the drive. Live classes
are in memory; they do not travel between computers or survive quitting.

WebView2 Runtime must be available on the destination PC. To include an offline
runtime, download and extract Microsoft's **x64 Fixed Version WebView2 Runtime**,
then set `LR_WEBVIEW2_DIR` to the folder containing `msedgewebview2.exe` when
building. The build copies it into `WebView2/`; the app selects it automatically.
Keep that bundled runtime updated when rebuilding. See Microsoft's
[WebView2 distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

Students must be on a reachable network, and Windows Firewall must permit the
server's incoming connections — see [Students scan the QR and nothing
loads](#students-scan-the-qr-and-nothing-loads). Managed PCs can block USB
applications or network access. The executable is unsigned. Portability cannot
guarantee execution on every computer; test the intended PC and PowerPoint
presentation setup first.

Build hosts need the standard project dependencies and Rust. On macOS/Linux,
install `cargo-xwin` and the `x86_64-pc-windows-msvc` Rust target; this command
cross-compiles locally without starting GitHub Actions. The server uses an official
Windows Node binary with a SEA blob generated using the same Node version and
with snapshots/code cache disabled, as required for cross-platform SEA generation.
Windows builds use matching x64 Node and MSVC Rust toolchains.

Portable build verification on 2026-09-08 (cross-built on Apple Silicon macOS):

- Windows x64 release compilation completed with `cargo-xwin`.
- Both the GUI executable and bundled server identify as Windows x64 PE binaries.
- The portable ZIP passed its archive integrity check (approximately 36 MB).
- Workspace typechecking and all three tooling tests passed.
- This ZIP uses the installed WebView2 runtime; no fixed runtime is included.
- Windows execution, USB-local storage behaviour, firewall access, and the
  PowerPoint overlay still need an actual Windows PC test.

### Students scan the QR and nothing loads

First check the network address, then the firewall. A QR code can decode
correctly while its destination is unreachable from a phone.

- **Physical Windows PC:** connect the PC and phone to the same reachable Wi-Fi
  or LAN. Open the copied join link on the phone as well as scanning the QR.
- **Windows inside Parallels:** Shared networking gives Windows a private VM
  address, commonly `10.211.55.3`. The Mac can reach it, but phones on the real
  Wi-Fi normally cannot. In Parallels, select **Devices > Network > Bridged
  Network > Wi-Fi** (or the Ethernet adapter connected to the students' network).
  Wait for Windows to obtain a new address. The app refreshes its join address
  every 10 seconds; reopen the app if an older build keeps the previous address.
  Scan the newly displayed QR. Do not substitute the Mac's IP: the server runs
  inside Windows. See [Parallels network modes](https://kb.parallels.com/en/4948).

Both environments use the same app and automatic address selection. Bridging
is a VM setting, not a requirement for a physical PC. Networks that disallow
bridging or communication between devices need a different reachable network.

Windows Firewall can also block inbound connections on the **Public** profile,
including classroom Wi-Fi. A locally working page does not prove phones can
reach the server. Allow the server through the firewall in one of three ways:

- **In the app.** When the rule is missing, the launcher shows *Allow Students
  Through* beneath the class code. It raises a UAC prompt and adds the rule.
- **From the portable folder.** Right-click **Allow Firewall.cmd** and choose
  *Run as administrator*. Use this when the in-app prompt is refused or the
  machine is locked down.
- **By hand**, in an administrator terminal:

  ```powershell
  netsh advfirewall firewall add rule name=Lecture-React-Server dir=in `
    action=allow protocol=TCP localport=8787 profile=any
  ```

The rule is scoped to the **port**, not to `lr-server.exe`. A program rule is
tied to a full path, and the portable build runs from a USB stick: a rule granted
while the stick was `E:` silently stops applying the first time it mounts as
`F:`. Scoping to the port is what makes the fix survive moving between rooms and
machines.

All of that applies only to the **local** address. The default join address is an
internet address that needs no inbound connection and no firewall rule at all —
see [why](#why-the-join-address-is-an-internet-address-by-default). If phones
cannot connect and you had switched to **Use This Wi-Fi Instead**, switch back
first: many campus networks enable **client isolation**, which blocks
phone-to-laptop traffic regardless of any firewall rule. Check `LECTURE_LAN_IP`
too if the local address is not the adapter you expect.

## Publish a GitHub release without Actions

The Windows ZIP is built locally and uploaded directly with GitHub CLI. No hosted
build runner is needed. The commands below publish a testing pre-release; they do
not claim that Windows runtime testing has passed.

First commit the source changes used for the build. Run the following from the
repository root in macOS/Linux with GitHub CLI authenticated (`gh auth login`).
Choose an unused tag for each release; `v0.1.0-beta.1` is the example below.

The first API call **disables all GitHub Actions for this repository** before the
push and release, so event-triggered workflows cannot consume runner minutes.
It requires repository admin permission and leaves Actions disabled until you
re-enable them in repository settings. The block stops if a command fails.

```bash
(
  set -e
  gh api --method PUT \
    repos/jenna-studio/lecture-reaction/actions/permissions \
    -F enabled=false

  test -z "$(git status --porcelain)" || {
    echo "Commit the source changes before building and publishing."
    exit 1
  }

  pnpm build:windows:portable
  git push origin HEAD

  cat > /tmp/lecture-react-release-notes.md <<'NOTES'
Portable Windows test release.

Extract the entire ZIP and open Lecture React.exe. Keep all included files together.
Run from a desktop folder or writable USB drive. No app installation, Node.js, or Rust is required.

Requires 64-bit Windows 10/11 and Microsoft Edge WebView2 Runtime.
Students need a reachable shared network and firewall permission for server connections.
If a scanned QR code will not load, use "Allow Students Through" in the launcher, or
right-click "Allow Firewall.cmd" and choose "Run as administrator".
Settings use the adjacent Data folder. Active classes end when the app closes.

This build is unsigned. Windows execution and PowerPoint overlay behavior still need testing.
NOTES

  gh release create v0.1.0-beta.1 \
    "dist/Lecture-React-Windows-x64-Portable.zip" \
    --repo jenna-studio/lecture-reaction \
    --target "$(git rev-parse HEAD)" \
    --title "Lecture React v0.1.0 Beta 1 - Windows Portable" \
    --prerelease \
    --notes-file /tmp/lecture-react-release-notes.md
)
```

If the ZIP was already built from the committed source, skip the
`pnpm build:windows:portable` line to reuse it. Share the release page after the
upload succeeds. Private repositories require testers to have repository access.
GitHub's automatic source-code archives are not the portable app: testers should
choose the attached `Lecture-React-Windows-x64-Portable.zip`.

References: [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create)
and [repository Actions permissions](https://docs.github.com/en/rest/actions/permissions#set-github-actions-permissions-for-a-repository).
