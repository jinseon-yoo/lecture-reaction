import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, pnpmCommand } from './platform.mjs';
import { stageCloudflaredSidecar } from './fetch-cloudflared.mjs';

/*
 * Signing.
 *
 * Ad-hoc by default, which is enough to run locally but NOT enough to download:
 * macOS quarantines anything from a browser and refuses to launch an unnotarized
 * app, so every user has to clear the flag by hand.
 *
 * Set both of these and the build signs with your Developer ID and notarizes
 * with Apple instead, which makes a plain double-click work for everyone:
 *
 *   LR_MACOS_IDENTITY="Developer ID Application: NAME (TEAMID)"
 *   LR_NOTARY_PROFILE="lecture-react"   # xcrun notarytool store-credentials
 */
const identity = process.env.LR_MACOS_IDENTITY?.trim();
const notaryProfile = process.env.LR_NOTARY_PROFILE?.trim();
const entitlements = join(REPO, 'apps/overlay/src-tauri/entitlements.plist');

/*
 * One app per architecture, deliberately not a universal build.
 *
 * A universal app needs a universal sidecar, and the server sidecar is a Node
 * SEA: ~110 MB thin, ~220 MB fat. macOS never finishes validating a fat binary
 * that size on a GUI launch out of /Applications — the app sits in dyld with no
 * window, no server and no crash report, forever. Thin sidecars launch fine, so
 * each architecture ships its own app and each download is half the size.
 */
const TARGETS = [
  { triple: 'aarch64-apple-darwin', name: 'Lecture-React-macOS-AppleSilicon', label: 'Apple Silicon' },
  { triple: 'x86_64-apple-darwin', name: 'Lecture-React-macOS-Intel', label: 'Intel' },
];

const app = 'Lecture React.app';
const run = (command, args, env, cwd = REPO) =>
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const pnpm = (args, env) => { const [cmd, argv] = pnpmCommand(args); run(cmd, argv, env); };

if (process.platform !== 'darwin') throw new Error('A macOS app can only be built on macOS.');

pnpm(['-F', '@lr/student', 'build'], process.env);
pnpm(['-F', '@lr/overlay', 'build'], process.env);

const built = [];
for (const target of TARGETS) {
  console.log(`\n=== ${target.label} (${target.triple}) ===`);
  const env = { ...process.env, LR_BUILD_TARGET: target.triple };
  run(process.execPath, [join(REPO, 'tools/build-server-binary.mjs')], env);
  await stageCloudflaredSidecar(target.triple);
  // The web assets are built once above, so Tauri's own beforeBuildCommand would
  // only repeat the work — and would rebuild the sidecar for the wrong arch.
  pnpm(['tauri', 'build', '--target', target.triple, '--bundles', 'app',
    '--config', JSON.stringify({ build: { beforeBuildCommand: '' } })], env);

  const source = join(REPO, 'apps/overlay/src-tauri/target', target.triple, 'release/bundle/macos', app);
  if (!existsSync(source)) throw new Error(`Tauri did not produce ${source}`);
  const output = join(REPO, 'dist', target.name);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(source, join(output, app), { recursive: true, verbatimSymlinks: true });

  const bundled = join(output, app);
  run('xattr', ['-cr', bundled], env);
  if (identity) {
    // Nested code first, then the bundle: signing the outer app seals whatever
    // the inner binaries look like at that moment, so re-signing lr-server
    // afterwards would invalidate the app's own signature.
    const sign = (target) => run('codesign', [
      '--force', '--timestamp',
      '--options', 'runtime',
      '--entitlements', entitlements,
      '--sign', identity,
      target,
    ], env);
    // Both sidecars: cloudflared arrives signed by Cloudflare, but notarization
    // wants every nested executable under the same Developer ID as the app.
    sign(join(bundled, 'Contents/MacOS/lr-server'));
    sign(join(bundled, 'Contents/MacOS/cloudflared'));
    sign(bundled);
  } else {
    // An arm64 Mac refuses to launch code that is not signed at all, and Tauri
    // leaves the bundle unsigned. Ad-hoc is enough to run from this machine; a
    // downloaded copy still has to have its quarantine flag cleared by hand.
    run('codesign', ['--force', '--deep', '--sign', '-', bundled], env);
  }
  run('codesign', ['--verify', '--deep', '--strict', bundled], env);

  const executable = execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleExecutable', join(bundled, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  const wanted = target.triple.startsWith('aarch64') ? 'arm64' : 'x86_64';
  for (const binary of [executable, 'lr-server', 'cloudflared']) {
    const archs = execFileSync('lipo', ['-archs', join(bundled, 'Contents/MacOS', binary)], { encoding: 'utf8' }).trim();
    // Thin on purpose: a fat sidecar is the launch hang described above.
    if (archs !== wanted) throw new Error(`${binary} should be exactly ${wanted}, got "${archs}"`);
  }
  if (!existsSync(join(bundled, 'Contents/Resources/student/index.html'))) {
    throw new Error('the student app is missing from the bundle');
  }

  writeFileSync(join(output, 'READ ME.txt'), `LECTURE REACT - MACOS (${target.label.toUpperCase()})

This build is for ${target.label} Macs. Check yours under
Apple menu > About This Mac: it names either an Apple chip or an Intel one.

1. Drag "Lecture React.app" anywhere you like: Applications, the Desktop,
   an external drive. It is one self-contained app with nothing to install.
2. BEFORE opening it the first time, clear the download flag. This app is not
   notarized by Apple, so macOS blocks a downloaded copy outright. Open
   Terminal, type the following, drag the app onto the window, press Return:
      xattr -dr com.apple.quarantine
   (the command ends with a space, then the dragged-in path). Then open the app
   normally. This is needed once, not every launch.
   On macOS 15 and later, right-clicking the app and choosing Open NO LONGER
   bypasses this. If you already tried to open it and macOS refused, go to
   System Settings > Privacy & Security, find the message about Lecture React
   near the bottom, and click Open Anyway.
3. The very first launch can take 10-30 seconds while macOS checks the app.
   Later launches are quick.
4. Allow incoming connections when macOS asks. Students need to reach this Mac.
5. Connect students to the same network and share the QR code or join link.
   The QR code is an internet address by default, so it works from any network
   the phones are on - including when the school Wi-Fi blocks devices from
   reaching each other, which is common. It needs internet on this Mac and on
   the phones, and a few seconds at startup.
6. Students scan the QR code, then type the class code shown on your screen.
   The link alone does not let anyone in.

No Node, pnpm, Rust, or separate server install is required.

Settings live in your home folder, not inside the app, so copying the app to
another Mac starts it fresh. Live classes and questions are held in memory and
end when the app closes.
`);

  if (identity && notaryProfile) {
    // Apple wants the bundle in a container to inspect; the ticket is then
    // stapled INTO the .app, so the shipped archive must be built afterwards.
    const upload = join(REPO, 'dist', `${target.name}-notarize.zip`);
    rmSync(upload, { force: true });
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundled, upload], env);
    console.log('   submitting to Apple for notarization (this takes a few minutes)…');
    run('xcrun', ['notarytool', 'submit', upload,
      '--keychain-profile', notaryProfile, '--wait'], env);
    run('xcrun', ['stapler', 'staple', bundled], env);
    rmSync(upload, { force: true });
    // The real test: what Gatekeeper says about a downloaded copy.
    run('spctl', ['-a', '-vv', bundled], env);
  } else {
    console.log(identity
      ? '   signed with Developer ID but NOT notarized (set LR_NOTARY_PROFILE)'
      : '   ad-hoc signed: downloads need their quarantine flag cleared by hand');
  }

  const zip = join(REPO, 'dist', `${target.name}.zip`);
  rmSync(zip, { force: true });
  // ditto, not zip: it is the only archiver that keeps the bundle's symlinks and
  // executable bits intact, and a mangled .app will not launch.
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', output, zip], env, join(REPO, 'dist'));
  built.push({ ...target, output, zip });
}

console.log('\nBuilt:');
for (const b of built) console.log(`  ${b.label}: ${b.zip}`);
