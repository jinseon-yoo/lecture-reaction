import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, pnpmCommand } from './platform.mjs';

const target = 'x86_64-pc-windows-msvc';
const env = { ...process.env, LR_BUILD_TARGET: target };
const run = (command, args, cwd = REPO) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const pnpm = (args) => { const [cmd, argv] = pnpmCommand(args); run(cmd, argv); };
if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw new Error('Unsupported build host');
pnpm(['-F', '@lr/student', 'build']);
pnpm(['-F', '@lr/overlay', 'build']);
run(process.execPath, [join(REPO, 'tools/build-server-binary.mjs')]);
// Preparation above deliberately targets Windows, including when building on macOS.
pnpm(['tauri', 'build', '--target', target, '--no-bundle',
  ...(process.platform === 'win32' ? [] : ['--runner', 'cargo-xwin']),
  '--config', JSON.stringify({ build: { beforeBuildCommand: '' } })]);
const release = join(REPO, 'apps/overlay/src-tauri/target', target, 'release');
const name = 'Lecture-React-Windows-x64-Portable';
const output = join(REPO, 'dist', name);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(release, 'lecture-react.exe'), join(output, 'Lecture React.exe'));
cpSync(join(REPO, `apps/overlay/src-tauri/binaries/lr-server-${target}.exe`), join(output, 'lr-server.exe'));
cpSync(join(REPO, 'apps/student/dist'), join(output, 'student'), { recursive: true });
writeFileSync(join(output, 'portable.txt'), 'Store WebView2 settings in the adjacent Data folder.\r\n');
// The app offers the same rule from the launcher, but a locked-down machine may
// refuse the UAC prompt raised by a webview; this is the fallback an IT desk can
// run directly. The rule is scoped to the port, not to the exe path, so it keeps
// working when the USB drive mounts under a different letter.
writeFileSync(join(output, 'Allow Firewall.cmd'), `@echo off
REM Lets students reach Lecture React on this computer.
REM Right-click this file and choose "Run as administrator".
netsh advfirewall firewall delete rule name=Lecture-React-Server >nul 2>&1
netsh advfirewall firewall add rule name=Lecture-React-Server dir=in action=allow protocol=TCP localport=8787 profile=any
if errorlevel 1 (
  echo.
  echo Could not add the rule. Right-click this file and choose "Run as administrator".
) else (
  echo.
  echo Done. Students on the same network can now open the QR link.
)
pause
`.replaceAll('\n', '\r\n'));
if (process.env.LR_WEBVIEW2_DIR) {
  const runtime = resolve(process.env.LR_WEBVIEW2_DIR);
  if (!existsSync(join(runtime, 'msedgewebview2.exe'))) throw new Error('LR_WEBVIEW2_DIR must contain an extracted x64 fixed WebView2 runtime');
  cpSync(runtime, join(output, 'WebView2'), { recursive: true });
}
writeFileSync(join(output, 'READ ME.txt'), `LECTURE REACT - WINDOWS USB EDITION

1. Extract the entire folder onto a writable USB drive.
2. Open Lecture React.exe. Keep lr-server.exe and student beside it.
3. When Windows Firewall asks, tick BOTH Private and Public, then Allow access.
4. Connect students to the same network and share the QR code or join link.
5. Quit the app fully before safely ejecting the USB drive.

IF STUDENTS SCAN THE QR AND THE PAGE WILL NOT LOAD
If Windows runs inside Parallels, Shared networking gives it a private VM
address (often 10.211.55.3) that phones cannot normally reach. In Parallels choose
Devices > Network > Bridged Network > Wi-Fi (or your connected Ethernet adapter).
Wait for Windows to get a new address, then scan the refreshed QR. The app
refreshes the address every 10 seconds; reopen older builds if needed.
On a physical Windows PC, connect the PC and phones to the same reachable LAN.

Windows Firewall may also drop incoming connections, especially on a Public
network profile. The launcher shows an "Allow Students Through" button when the rule
is missing. If that prompt is refused or unavailable, right-click
"Allow Firewall.cmd" and choose "Run as administrator" instead.

Still nothing? Some campus Wi-Fi isolates clients from each other, which blocks
phone-to-laptop traffic no matter what the firewall says. A phone hotspot that
the laptop and the students both join is the usual way around it.

Requires x64 Windows 10/11 and Microsoft Edge WebView2 Runtime.
If WebView2 is missing, install it from https://developer.microsoft.com/microsoft-edge/webview2/
or put an extracted x64 Fixed Version runtime in the WebView2 folder.
A school or workplace policy may block executables or incoming connections.
This build is unsigned and may trigger a Windows security prompt.

Settings and browser storage are kept in Data beside the app. Use a writable drive.
Live classes and questions are held in memory and end when the app closes.
USB portability does not preserve an active class between computers.
No Node, pnpm, Rust, or app installation is required on the presentation PC.
` .replaceAll('\n', '\r\n'));
const zip = join(REPO, 'dist', `${name}.zip`);
rmSync(zip, { force: true });
if (process.platform === 'win32') {
  env.LR_PORTABLE_DIR = output;
  env.LR_PORTABLE_ZIP = zip;
  run('powershell.exe', ['-NoProfile', '-Command',
    'Compress-Archive -LiteralPath $env:LR_PORTABLE_DIR -DestinationPath $env:LR_PORTABLE_ZIP'], REPO);
} else {
  run('zip', ['-qr', zip, name], join(REPO, 'dist'));
}
console.log(`Portable app: ${output}\nUSB archive: ${zip}`);
