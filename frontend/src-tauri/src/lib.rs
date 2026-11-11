mod activity;
mod geometry;
mod session;

use geometry::{Layout, PET};
use session::{Action, Session};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
};

#[derive(Default)]
struct AppState {
    session: Mutex<Session>,
    activity: Mutex<activity::Detector>,
    layout: Mutex<Layout>,
    positioned: AtomicBool,
}
type Result<T> = std::result::Result<T, String>;
fn native<T>(value: tauri::Result<T>) -> Result<T> {
    value.map_err(|error| error.to_string())
}
fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("{label} 창을 찾지 못했어요."))
}
fn allowed(caller: &WebviewWindow) -> Result<()> {
    if ["main", "widget"].contains(&caller.label()) {
        Ok(())
    } else {
        Err("허용되지 않은 창이에요.".into())
    }
}

#[tauri::command]
fn session_read(caller: WebviewWindow, state: State<'_, AppState>) -> Result<Session> {
    allowed(&caller)?;
    Ok(state.session.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn session_action(
    caller: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    action: Action,
) -> Result<Session> {
    allowed(&caller)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let next = {
        let mut session = state.session.lock().map_err(|e| e.to_string())?;
        let reset = matches!(&action, Action::Start { .. } | Action::End);
        session.apply(action, now, cfg!(debug_assertions))?;
        // Commands and sampler always acquire session before activity.
        let mut detector = state.activity.lock().map_err(|e| e.to_string())?;
        if reset || !session.running {
            detector.reset_session();
        } else if session.paused {
            detector.stop();
        }
        let _ = app.emit("activity-state", &detector.view);
        session.clone()
    };
    // The acknowledgement is also a snapshot; revision ordering tolerates event/response races.
    let _ = app.emit("focus-session", &next);
    Ok(next)
}

fn activity_now() -> u64 {
    static CLOCK: std::sync::OnceLock<(std::time::Instant, u64)> = std::sync::OnceLock::new();
    let (start, epoch) = CLOCK.get_or_init(|| {
        (
            std::time::Instant::now(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        )
    });
    epoch + start.elapsed().as_millis() as u64
}

#[tauri::command]
fn activity_read(caller: WebviewWindow, state: State<'_, AppState>) -> Result<activity::View> {
    allowed(&caller)?;
    Ok(state
        .activity
        .lock()
        .map_err(|e| e.to_string())?
        .view
        .clone())
}

#[tauri::command]
fn activity_configure(
    caller: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    config: activity::Config,
) -> Result<activity::View> {
    allowed(&caller)?;
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    let mut detector = state.activity.lock().map_err(|e| e.to_string())?;
    detector.configure(config, cfg!(debug_assertions))?;
    if session.running {
        session.character = if session.paused {
            session::Character::Idle
        } else {
            session::Character::Focus
        };
        session.simulated = false;
        session.revision += 1;
    }
    let _ = app.emit("focus-session", &*session);
    let _ = app.emit("activity-state", &detector.view);
    Ok(detector.view.clone())
}

#[tauri::command]
fn activity_respond(
    caller: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    id: u64,
    choice: String,
) -> Result<activity::View> {
    allowed(&caller)?;
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    let mut detector = state.activity.lock().map_err(|e| e.to_string())?;
    if !session.running || (choice == "claim" && session.paused) {
        return Err("집중 세션을 재개한 뒤 확인해 주세요.".into());
    }
    detector.respond(id, &choice, activity_now())?;
    session.simulated = false;
    session.character = match choice.as_str() {
        "claim" | "review" => session::Character::Checkin,
        "resolved" => session::Character::Recovery,
        "break" => session::Character::Idle,
        _ => session::Character::Focus,
    };
    if choice == "break" {
        session.paused = true;
        detector.stop();
    }
    if session.paused {
        session.character = session::Character::Idle;
    }
    session.revision += 1;
    let _ = app.emit("focus-session", &*session);
    let _ = app.emit("activity-state", &detector.view);
    Ok(detector.view.clone())
}

fn resize_widget(app: &AppHandle, open: bool) -> Result<Layout> {
    let widget = window(app, "widget")?;
    let state = app.state::<AppState>();
    let old = *state.layout.lock().map_err(|e| e.to_string())?;
    let position = native(widget.outer_position())?;
    let scale = native(widget.scale_factor())?;
    let monitor = native(widget.current_monitor())?
        .or(native(widget.primary_monitor())?)
        .ok_or("모니터를 찾지 못했어요.")?;
    let area = monitor.work_area();
    let anchor = (
        position.x as f64 + old.pet_x * scale,
        position.y as f64 + old.pet_y * scale,
    );
    let (position, layout) = geometry::place(
        anchor,
        (
            area.position.x as f64,
            area.position.y as f64,
            area.position.x as f64 + area.size.width as f64,
            area.position.y as f64 + area.size.height as f64,
        ),
        scale,
        open,
    );
    // Update before focus operations: a blur may be delivered synchronously.
    *state.layout.lock().map_err(|e| e.to_string())? = layout;
    native(widget.set_size(LogicalSize::new(layout.width, layout.height)))?;
    native(widget.set_position(PhysicalPosition::new(
        position.0.round() as i32,
        position.1.round() as i32,
    )))?;
    native(widget.set_focusable(open))?;
    let _ = app.emit_to("widget", "widget-layout", layout);
    if open {
        native(widget.set_focus())?;
    }
    Ok(layout)
}

#[tauri::command]
fn widget_read_layout(caller: WebviewWindow, state: State<'_, AppState>) -> Result<Layout> {
    allowed(&caller)?;
    Ok(*state.layout.lock().map_err(|e| e.to_string())?)
}

#[tauri::command]
fn widget_bubble(caller: WebviewWindow, app: AppHandle, open: bool) -> Result<Layout> {
    allowed(&caller)?;
    resize_widget(&app, open)
}

fn present_widget(app: &AppHandle, hide_main: bool) -> Result<()> {
    let widget = window(app, "widget")?;
    let main = window(app, "main")?;
    let state = app.state::<AppState>();
    resize_widget(app, false)?;
    if !state.positioned.load(Ordering::Relaxed) {
        let monitor = native(main.current_monitor())?
            .or(native(main.primary_monitor())?)
            .ok_or("모니터를 찾지 못했어요.")?;
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let x = area.position.x as f64 + area.size.width as f64 - (PET + 24.0) * scale;
        let y = area.position.y as f64 + area.size.height as f64 - (PET + 24.0) * scale;
        native(widget.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)))?;
        state.positioned.store(true, Ordering::Relaxed);
    }
    native(widget.unminimize())?;
    native(widget.show())?;
    // Never hide the recovery path until the pet window is successfully shown.
    if hide_main {
        native(main.hide())?;
    }
    Ok(())
}

#[tauri::command]
fn widget_show(caller: WebviewWindow, app: AppHandle, hide_main: bool) -> Result<()> {
    allowed(&caller)?;
    present_widget(&app, hide_main)
}

fn restore_main(app: &AppHandle, target: &str) -> Result<()> {
    if target != "plan" && target != "input" {
        return Err("알 수 없는 화면이에요.".into());
    }
    let main = window(app, "main")?;
    native(main.unminimize())?;
    native(main.show())?;
    native(app.emit_to("main", "main-navigate", target))?;
    native(main.set_focus())?;
    let _ = resize_widget(app, false);
    Ok(())
}

#[tauri::command]
fn main_show(caller: WebviewWindow, app: AppHandle, target: String) -> Result<()> {
    allowed(&caller)?;
    restore_main(&app, &target)
}

#[tauri::command]
fn widget_conceal(caller: WebviewWindow, app: AppHandle, minimize: bool) -> Result<()> {
    allowed(&caller)?;
    // Hidden/minimized pets remain recoverable from the visible main window.
    restore_main(&app, "plan")?;
    let widget = window(&app, "widget")?;
    if minimize {
        native(widget.minimize())
    } else {
        native(widget.hide())
    }
}

#[tauri::command]
fn widget_drag(caller: WebviewWindow, app: AppHandle) -> Result<()> {
    if caller.label() != "widget" {
        return Err("위젯 창에서만 이동할 수 있어요.".into());
    }
    resize_widget(&app, false)?;
    native(caller.start_dragging())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|app| {
            let app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let state = app.state::<AppState>();
                let Ok(mut session) = state.session.lock() else {
                    break;
                };
                let Ok(mut detector) = state.activity.lock() else {
                    break;
                };
                if session.running && !session.paused && detector.view.consent {
                    if detector.poll(
                        session.running,
                        session.paused,
                        activity_now(),
                        activity::sample,
                    ) {
                        session.character = session::Character::Suspect;
                        session.simulated = false;
                        session.revision += 1;
                        // Expression only: never show a window, open a bubble or request focus here.
                        let _ = app.emit("focus-session", &*session);
                    }
                    let _ = app.emit("activity-state", &detector.view);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session_read,
            session_action,
            activity_read,
            activity_configure,
            activity_respond,
            widget_read_layout,
            widget_bubble,
            widget_show,
            main_show,
            widget_conceal,
            widget_drag
        ])
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { .. }) => window.app_handle().exit(0),
            ("widget", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = restore_main(window.app_handle(), "plan");
                let _ = window.hide();
            }
            ("widget", WindowEvent::Focused(false)) => {
                let open = window
                    .state::<AppState>()
                    .layout
                    .lock()
                    .map(|layout| layout.open)
                    .unwrap_or(false);
                if open {
                    let _ = resize_widget(window.app_handle(), false);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("failed to run IN-VIBE desktop app");
}
