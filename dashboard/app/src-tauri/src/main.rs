mod launch;

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use launch::{read_launch_link, LinkFailure, LINK_WAIT};

const WINDOW: &str = "main";
const SERVER_FILE: &str = "server/bin/mg-dashboard-server.mjs";
const QUIT_SCHEME: &str = "mg-quit";
const STDERR_KEPT: usize = 16 * 1024;

/// The server process while it runs. Taken out when it is stopped.
struct Server(Mutex<Option<Child>>);

/// The tail of what the server wrote to stderr.
struct StderrTail {
    text: Arc<Mutex<Vec<u8>>>,
    reader: JoinHandle<()>,
}

impl StderrTail {
    fn follow<R: Read + Send + 'static>(mut stderr: R) -> StderrTail {
        let text = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&text);
        let reader = thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(read) = stderr.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                let mut kept = kept.lock().unwrap();
                kept.extend_from_slice(&chunk[..read]);
                if kept.len() > STDERR_KEPT {
                    let excess = kept.len() - STDERR_KEPT;
                    kept.drain(..excess);
                }
            }
        });
        StderrTail { text, reader }
    }

    /// Call after the server has stopped, so the pipe has ended.
    fn finish(self) -> String {
        let _ = self.reader.join();
        let text = self.text.lock().unwrap();
        String::from_utf8_lossy(&text).trim().to_string()
    }
}

fn stop_server(app: &AppHandle) {
    let child = app.state::<Server>().0.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Starts the server and returns its launch link, or why there is none.
fn start_server(app: &AppHandle) -> Result<(Url, StderrTail), String> {
    let node = std::env::current_exe()
        .map_err(|error| format!("Cannot find the app's own path: {error}"))?
        .with_file_name("node");
    let script = app
        .path()
        .resolve(SERVER_FILE, tauri::path::BaseDirectory::Resource)
        .map_err(|error| format!("Cannot find the server file: {error}"))?;

    let mut child = Command::new(&node)
        .arg(&script)
        .arg("--exit-when-stdin-closes")
        // The write end stays in `child` for the app's whole life. The
        // kernel closes it when the app dies in any way, and the server
        // exits on that.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Cannot start {}: {error}", node.display()))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = StderrTail::follow(child.stderr.take().expect("stderr is piped"));
    *app.state::<Server>().0.lock().unwrap() = Some(child);

    match read_launch_link(stdout, LINK_WAIT) {
        Ok(link) => match Url::parse(&link) {
            Ok(url) => Ok((url, stderr)),
            Err(error) => Err(fail(
                app,
                LinkFailure::NotALink(format!("{link} ({error})")),
                stderr,
            )),
        },
        Err(failure) => Err(fail(app, failure, stderr)),
    }
}

/// Stops the server and gives the message the window shows.
fn fail(app: &AppHandle, failure: LinkFailure, stderr: StderrTail) -> String {
    stop_server(app);
    let written = stderr.finish();
    if written.is_empty() {
        failure.describe()
    } else {
        format!("{}\n\n{written}", failure.describe())
    }
}

fn open_dashboard(app: AppHandle, window: WebviewWindow) {
    match start_server(&app) {
        Ok((link, _stderr)) => {
            if let Err(error) = window.navigate(link) {
                show_failure(
                    &window,
                    &format!("Cannot open the window on the launch link: {error}"),
                );
                stop_server(&app);
            }
        }
        Err(message) => show_failure(&window, &message),
    }
}

fn show_failure(window: &WebviewWindow, message: &str) {
    let reason = serde_json::to_string(message).expect("a string is JSON");
    let _ = window.eval(format!("showFailure({reason})"));
}

fn focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus(app);
        }))
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let quitter = handle.clone();
            // The window may show the startup page and the server's own
            // address, nothing else. The startup page's Quit link is a
            // navigation, so the page needs no Tauri API.
            let window =
                WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
                    .title("mg dashboard")
                    .inner_size(1280.0, 860.0)
                    .on_navigation(move |url| match url.scheme() {
                        QUIT_SCHEME => {
                            quitter.exit(0);
                            false
                        }
                        "tauri" => true,
                        "http" => url.host_str() == Some("127.0.0.1"),
                        _ => false,
                    })
                    .build()?;
            thread::spawn(move || open_dashboard(handle, window));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("cannot build the app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}
