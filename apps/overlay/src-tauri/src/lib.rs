//! Lecture React — desktop shell.
//!
//! Two windows:
//!   * `launcher` — a small ordinary window (START CLASS / class code / QR).
//!   * `overlay`  — a transparent, borderless, always-on-top, click-through
//!                  window covering the whole screen. Created hidden at
//!                  startup so showing it later is instant.
//!
//! ---------------------------------------------------------------------------
//! CLICK-THROUGH (the least obvious mechanic in this codebase)
//! ---------------------------------------------------------------------------
//! The overlay must let every click reach PowerPoint/Keynote underneath, while
//! a handful of small widgets (control strip, question cards, resolve buttons)
//! stay clickable. There is no per-region hit-testing API in a webview: a
//! window either swallows cursor events or it does not
//! (`set_ignore_cursor_events`).
//!
//! So we do the hit-testing ourselves, in the frontend, driven from Rust:
//!
//!   1. When the overlay window is created we spawn a background thread that
//!      polls the *global* cursor position every ~50 ms.
//!   2. It converts that screen point into the overlay window's LOGICAL
//!      coordinate space — subtract the window's outer position, divide by the
//!      scale factor — which is exactly the space `getBoundingClientRect()`
//!      reports in. It emits it as a `cursor-moved` event to the overlay.
//!   3. The frontend hit-tests that point against every element marked
//!      interactive and calls `set_click_through(enabled)` ONLY when the answer
//!      flips. Nothing crosses the IPC boundary on a normal tick.
//!
//! While the window is ignoring cursor events it receives no DOM mouse events
//! at all — that is why the position has to come from the OS side rather than
//! from `mousemove`.
//!
//! `set_interaction_mode(true)` ("full interaction", bound to Cmd/Ctrl+Shift+L)
//! pins the window to *never* ignore cursor events, so the professor can grab
//! the strip without chasing pixels.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const LAUNCHER_LABEL: &str = "launcher";
pub const OVERLAY_LABEL: &str = "overlay";

/// How often the cursor is sampled. 20 Hz is imperceptible for hovering a
/// button and costs almost nothing.
const CURSOR_POLL_MS: u64 = 50;
/// Cursor ticks between display-layout re-checks (~1s at 50ms).
const BOUNDS_CHECK_TICKS: u32 = 20;

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

#[derive(Default)]
pub struct OverlayState {
    /// Last value the frontend asked for via `set_click_through`.
    wants_click_through: AtomicBool,
    /// Full-interaction mode overrides `wants_click_through`.
    interaction_mode: AtomicBool,
    /// Quiet mode lives in the frontend; Rust only owns the shortcut toggle.
    quiet_mode: AtomicBool,
    /// Cleared when the overlay window goes away, which stops the poll thread.
    cursor_thread_running: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct CursorPoint {
    /// Logical CSS pixels, relative to the overlay window's top-left.
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
struct ToggleEvent {
    enabled: bool,
}

/* ------------------------------------------------------------------ */
/* Window plumbing                                                     */
/* ------------------------------------------------------------------ */

/// Screen geometry the overlay should cover.
///
/// Re-read every time it is needed, never cached. A teaching machine's display
/// layout changes constantly — the projector is plugged in after the app is
/// open, the resolution switches when the presentation starts, the laptop is
/// mirrored and then extended. Deriving this once at window construction meant
/// the overlay kept whatever rectangle the machine happened to have at launch,
/// so it covered the wrong area (or a screen that no longer existed) for the
/// rest of the session. From the professor's side that looks exactly like the
/// transparent overlay being broken: the window is fine, it is simply drawing
/// somewhere the slides are not.
fn overlay_bounds<R: Runtime>(app: &AppHandle<R>) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    // `available_monitors`/`primary_monitor` can both fail on a headless or
    // still-initialising display server; fall back to a sane default rather
    // than refusing to open the overlay.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        // NOTE: we deliberately use the *full* monitor rectangle rather than
        // the work area. The overlay is click-through, so covering the menu
        // bar / dock costs the professor nothing, and it keeps the overlay
        // aligned with a fullscreen presentation. (`Monitor::work_area` is
        // available in newer Tauri 2.x; switching to it is a one-line change.)
        (*monitor.position(), *monitor.size())
    } else {
        (PhysicalPosition::new(0, 0), PhysicalSize::new(1440, 900))
    }
}

/// Snaps the overlay onto the current screen rectangle.
///
/// Physical pixels on purpose: the logical size Tauri computes from a scale
/// factor rounds, and a rounded full-screen overlay leaves a hairline of
/// desktop showing along one edge.
fn apply_overlay_bounds<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let (pos, size) = overlay_bounds(app);
    let _ = window.set_position(pos);
    let _ = window.set_size(size);
}

/// Creates the overlay window, hidden. Idempotent.
fn build_overlay<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(existing);
    }

    let (pos, size) = overlay_bounds(app);
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        // The frontend routes on `?window=`, which also makes the overlay
        // reviewable in a plain browser.
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("Lecture React Overlay")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .shadow(false)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .visible(false)
    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
    .position(pos.x as f64 / scale, pos.y as f64 / scale)
    .build()?;

    // Cover the screen exactly, in physical pixels, regardless of rounding in
    // the logical sizes above.
    apply_overlay_bounds(app, &window);

    // Stay above a fullscreen Keynote/PowerPoint and follow the professor
    // across Spaces. Both calls are best-effort: on platforms/versions where
    // they are unsupported they simply return an error we ignore.
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.set_always_on_top(true);

    // Start fully click-through: presentation mode is the default state.
    let _ = window.set_ignore_cursor_events(true);
    app.state::<OverlayState>()
        .wants_click_through
        .store(true, Ordering::Relaxed);

    spawn_cursor_poller(app.clone(), window.clone());

    // Stop the poller if the window is destroyed.
    {
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                app_handle
                    .state::<OverlayState>()
                    .cursor_thread_running
                    .store(false, Ordering::Relaxed);
            }
        });
    }

    Ok(window)
}

/// Step 1+2 of the click-through mechanic: poll the OS cursor and hand the
/// overlay the point in its own logical coordinate space.
fn spawn_cursor_poller<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    let running = app.state::<OverlayState>().cursor_thread_running.clone();
    if running.swap(true, Ordering::SeqCst) {
        return; // already polling
    }

    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN);
        // Display layout is re-checked on a slow multiple of the cursor tick.
        let mut ticks_until_bounds_check: u32 = 0;
        while running.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(CURSOR_POLL_MS));

            // If the overlay is hidden there is nothing to hit-test.
            if !window.is_visible().unwrap_or(false) {
                continue;
            }

            // Follow the screen while the class is running.
            //
            // There is no portable "display configuration changed" event to
            // subscribe to, and the professor changes the layout mid-lecture
            // more often than anyone expects: switching PowerPoint into
            // presenter view, mirroring for a question, unplugging at the end.
            // This thread is already awake, so it re-reads the monitor
            // rectangle about once a second and re-snaps only when it actually
            // differs — which is never, until it matters.
            if ticks_until_bounds_check == 0 {
                ticks_until_bounds_check = BOUNDS_CHECK_TICKS;
                let (want_pos, want_size) = overlay_bounds(&app);
                let same = window.outer_position().is_ok_and(|p| p == want_pos)
                    && window.outer_size().is_ok_and(|s| s == want_size);
                if !same {
                    let _ = window.set_position(want_pos);
                    let _ = window.set_size(want_size);
                }
            } else {
                ticks_until_bounds_check -= 1;
            }

            let Ok(cursor) = app.cursor_position() else {
                continue;
            };
            let Ok(origin) = window.outer_position() else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0).max(0.1);

            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;

            // Sub-pixel jitter would spam the webview for no reason.
            if (x - last.0).abs() < 0.5 && (y - last.1).abs() < 0.5 {
                continue;
            }
            last = (x, y);

            let _ = window.emit("cursor-moved", CursorPoint { x, y });
        }
    });
}

/// Applies `wants_click_through` unless full-interaction mode overrides it.
fn apply_click_through<R: Runtime>(app: &AppHandle<R>, state: &OverlayState) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    let ignore = !state.interaction_mode.load(Ordering::Relaxed)
        && state.wants_click_through.load(Ordering::Relaxed);
    let _ = window.set_ignore_cursor_events(ignore);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn show_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    let window = build_overlay(&app).map_err(|e| e.to_string())?;
    // The window is pre-created at startup so this is instant, which means its
    // geometry is as old as the app. The projector is usually plugged in
    // somewhere between those two moments, so re-snap before showing it.
    apply_overlay_bounds(&app, &window);
    window.show().map_err(|e| e.to_string())?;
    // Never steal focus from the presentation.
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    apply_click_through(&app, &state);
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    state.cursor_thread_running.store(false, Ordering::Relaxed);
    Ok(())
}

/// Step 3: called by the frontend hit-test, and ONLY when the answer changes.
#[tauri::command]
fn set_click_through(app: AppHandle, state: State<'_, OverlayState>, enabled: bool) {
    state.wants_click_through.store(enabled, Ordering::Relaxed);
    apply_click_through(&app, &state);
}

/// Full-interaction mode: the overlay never ignores cursor events.
#[tauri::command]
fn set_interaction_mode(app: AppHandle, state: State<'_, OverlayState>, on: bool) {
    state.interaction_mode.store(on, Ordering::Relaxed);
    apply_click_through(&app, &state);
    let _ = app.emit_to(OVERLAY_LABEL, "interaction-mode", ToggleEvent { enabled: on });
}

/// Restores the launcher after the class ends.
#[tauri::command]
fn focus_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().ok();
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Gets the launcher out of the way once the overlay is up.
#[tauri::command]
fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, OverlayState>) {
    state.cursor_thread_running.store(false, Ordering::Relaxed);
    app.exit(0);
}

/* ------------------------------------------------------------------ */
/* Global shortcuts                                                    */
/* ------------------------------------------------------------------ */

/// `CmdOrCtrl` — Cmd on macOS, Ctrl elsewhere.
fn primary_modifier() -> Modifiers {
    #[cfg(target_os = "macos")]
    {
        Modifiers::SUPER | Modifiers::SHIFT
    }
    #[cfg(not(target_os = "macos"))]
    {
        Modifiers::CONTROL | Modifiers::SHIFT
    }
}

fn toggle_interaction_shortcut() -> Shortcut {
    Shortcut::new(Some(primary_modifier()), Code::KeyL)
}

fn toggle_quiet_shortcut() -> Shortcut {
    Shortcut::new(Some(primary_modifier()), Code::KeyH)
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Bundled realtime server                                             */
/* ------------------------------------------------------------------ */

/// Port the server listens on, matching the frontend's default origin.
const SERVER_PORT: u16 = 8787;

/// `CREATE_NO_WINDOW` — keeps console windows from flashing over the slides.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Handle to the server we started, so it dies with the app rather than
/// lingering and holding the port.
struct ServerProcess(Mutex<Option<std::process::Child>>);

/// True when something already answers on the server port — a `pnpm dev`
/// session, or a second copy of the app. Starting another would just fail to
/// bind and leave a confusing error, so we attach to the running one instead.
fn server_already_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], SERVER_PORT)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

/// Starts the bundled server sidecar.
///
/// The binary is a self-contained Node SEA build placed next to this
/// executable by Tauri's `externalBin`. In a `tauri dev` run it is absent,
/// which is fine: the dev server is already running.
fn start_server(app: &AppHandle) -> Option<std::process::Child> {
    if server_already_running() {
        println!("[lecture-react] realtime server already running on {SERVER_PORT}");
        return None;
    }

    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let binary = exe_dir.join(if cfg!(windows) { "lr-server.exe" } else { "lr-server" });
    if !binary.exists() {
        eprintln!(
            "[lecture-react] no bundled server at {} — expecting a dev server on {SERVER_PORT}",
            binary.display()
        );
        return None;
    }

    // The packaged server cannot locate the student app relative to its own
    // source, so it is told where the bundled copy lives. Same for the fonts
    // the end-of-class PDF is set in: they ship as a Tauri resource, not
    // beside the server binary where its source-tree default would look.
    let resources = app.path().resource_dir().ok();
    let student_dist = resources.as_ref().map(|dir| dir.join("student"));
    let fonts_dir = resources.as_ref().map(|dir| dir.join("fonts"));
    // Where the PDF lands. The server defaults to the same folder under the
    // home directory, but the OS knows better where "Documents" actually is
    // (localised, redirected, on a USB profile). Skipped when the lookup
    // fails; the server's own default takes over.
    let reports_dir = app
        .path()
        .document_dir()
        .map(|dir| dir.join("Lecture React Reports"))
        .ok();

    let mut cmd = std::process::Command::new(&binary);
    cmd.env("PORT", SERVER_PORT.to_string());
    if let Some(dist) = student_dist {
        cmd.env("LECTURE_STUDENT_DIST", dist);
    }
    if let Some(fonts) = fonts_dir {
        cmd.env("LECTURE_FONTS_DIR", fonts);
    }
    if let Some(reports) = reports_dir {
        cmd.env("LECTURE_REPORTS_DIR", reports);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW); // no server console over the slides.
    }

    match cmd.spawn() {
        Ok(child) => {
            println!("[lecture-react] started bundled server (pid {})", child.id());
            Some(child)
        }
        Err(err) => {
            eprintln!("[lecture-react] could not start bundled server: {err}");
            None
        }
    }
}

/* ------------------------------------------------------------------ */
/* Windows Firewall                                                    */
/* ------------------------------------------------------------------ */

/// Name of the inbound rule the app manages.
///
/// Deliberately free of spaces: it travels through PowerShell into `cmd` into
/// `netsh`, and quoting a value across three command lines is a good way to
/// create a rule nobody can find again.
#[cfg(windows)]
const FIREWALL_RULE: &str = "Lecture-React-Server";

/// What the launcher needs in order to decide whether to warn.
#[derive(Clone, Serialize)]
pub struct FirewallStatus {
    /// Only Windows blocks inbound connections by default; elsewhere there is
    /// nothing to check and nothing to offer.
    supported: bool,
    /// An inbound allow rule for the server port is present.
    allowed: bool,
}

/// True when our inbound rule exists. Reading rules needs no elevation.
#[cfg(windows)]
fn firewall_rule_present() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name={FIREWALL_RULE}"),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Whether students can actually reach the server.
///
/// This is where a lecture machine fails far more often than anywhere else in
/// the app. A school network is almost always classified Public, and Windows
/// drops inbound connections on the Public profile by default — so the QR code
/// encodes a perfectly correct address that no phone in the room can open.
/// Nothing in the app can observe that from the inside: the server binds
/// 0.0.0.0 and reports success either way.
#[tauri::command]
fn firewall_status() -> FirewallStatus {
    #[cfg(windows)]
    {
        FirewallStatus { supported: true, allowed: firewall_rule_present() }
    }
    #[cfg(not(windows))]
    {
        FirewallStatus { supported: false, allowed: true }
    }
}

/// Adds the inbound rule, prompting for administrator rights.
///
/// The rule is scoped to the port rather than to `lr-server.exe`. A program
/// rule is tied to a full path, and the portable build runs from a USB stick:
/// a rule granted while the stick was `E:` silently stops applying the first
/// time it mounts as `F:`, which is exactly the confusing half-working state
/// this is meant to end. `profile=any` is what covers the Public profile.
#[tauri::command]
fn allow_firewall() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Delete first so a second run repairs a damaged rule rather than
        // stacking duplicates. `&` rather than `&&`: the delete is expected to
        // fail on a clean machine and must not stop the add.
        let script = format!(
            "Start-Process -FilePath cmd.exe -Verb RunAs -WindowStyle Hidden -Wait \
             -ArgumentList '/c netsh advfirewall firewall delete rule name={rule} & \
             netsh advfirewall firewall add rule name={rule} dir=in action=allow \
             protocol=TCP localport={port} profile=any'",
            rule = FIREWALL_RULE,
            port = SERVER_PORT,
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|err| format!("could not run PowerShell: {err}"))?;

        // Trust the rule, not the exit code: a dismissed UAC prompt does not
        // reliably surface as a failure through two layers of Start-Process.
        if firewall_rule_present() {
            Ok(())
        } else {
            Err("The firewall rule was not added — administrator approval is required.".into())
        }
    }
    #[cfg(not(windows))]
    {
        Err("Firewall rules are only managed on Windows.".into())
    }
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/// Shows the file in the OS file manager, selected where the platform can.
///
/// The end-of-class report is written by the server, not by this process, so
/// the frontend only ever has a path. Selecting it in Finder/Explorer is the
/// one gesture that works for "where did it go?" without opening a PDF viewer
/// over the slides.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("no file at {path}"));
    }

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg("-R").arg(&target);
        cmd
    };
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        // Explorer wants `/select,<path>` as ONE argument; splitting it makes
        // it open the Documents folder instead of selecting the file.
        let mut cmd = std::process::Command::new("explorer");
        cmd.raw_arg(format!("/select,\"{}\"", target.display()));
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let mut cmd = {
        // No portable "select in file manager" on Linux; opening the folder is
        // the closest thing every desktop can do.
        let folder = target.parent().map(|p| p.to_path_buf()).unwrap_or(target.clone());
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(folder);
        cmd
    };

    cmd.spawn()
        .map(|_| ())
        .map_err(|err| format!("could not open the file manager: {err}"))
}

pub fn run() {
    // Set before Tauri creates either webview. Both windows share USB-local storage.
    #[cfg(windows)]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable.txt").is_file() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("Data"));
                if dir.join("WebView2/msedgewebview2.exe").is_file() {
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", dir.join("WebView2"));
                }
            }
        }
    }
    tauri::Builder::default()
        .manage(OverlayState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return; // one action per physical press
                    }
                    let state = app.state::<OverlayState>();

                    if shortcut == &toggle_interaction_shortcut() {
                        let on = !state.interaction_mode.load(Ordering::Relaxed);
                        state.interaction_mode.store(on, Ordering::Relaxed);
                        apply_click_through(app, &state);
                        let _ = app.emit_to(
                            OVERLAY_LABEL,
                            "interaction-mode",
                            ToggleEvent { enabled: on },
                        );
                    } else if shortcut == &toggle_quiet_shortcut() {
                        let on = !state.quiet_mode.load(Ordering::Relaxed);
                        state.quiet_mode.store(on, Ordering::Relaxed);
                        let _ =
                            app.emit_to(OVERLAY_LABEL, "quiet-mode", ToggleEvent { enabled: on });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            show_overlay,
            hide_overlay,
            close_overlay,
            set_click_through,
            set_interaction_mode,
            focus_launcher,
            hide_launcher,
            quit_app,
            firewall_status,
            allow_firewall,
            reveal_path,
        ])
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Start the realtime server before anything tries to connect.
            let child = start_server(&handle);
            if let Some(state) = app.try_state::<ServerProcess>() {
                if let Ok(mut slot) = state.0.lock() {
                    *slot = child;
                }
            }

            // Registration failures (another app owns the combo) must not stop
            // the class from starting — the on-screen controls still work.
            let shortcuts = app.global_shortcut();
            if let Err(err) = shortcuts.register(toggle_interaction_shortcut()) {
                eprintln!("[lecture-react] could not register Cmd/Ctrl+Shift+L: {err}");
            }
            if let Err(err) = shortcuts.register(toggle_quiet_shortcut()) {
                eprintln!("[lecture-react] could not register Cmd/Ctrl+Shift+H: {err}");
            }

            // Pre-create the overlay (hidden) so START OVERLAY is instant.
            if let Err(err) = build_overlay(&handle) {
                eprintln!("[lecture-react] overlay window could not be created: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lecture React")
        .run(|handle, event| {
            // Never leave the server running after the window closes: it would
            // hold port 8787 and the next launch would silently attach to a
            // server with no class in it.
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                if let Some(state) = handle.try_state::<ServerProcess>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(mut child) = slot.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
