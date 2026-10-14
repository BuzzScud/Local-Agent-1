// The window: one webview on the window server's page. `--url <address>` is the page to open (the
// window server gives it, with its key); without one it shows the stub until it is told.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{DragDropEvent, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, WindowEvent};

// A path as a JavaScript string, in double quotes (a name can hold any letter, a quote or a backslash).
fn js_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let url = args.iter().position(|a| a == "--url").and_then(|i| args.get(i + 1)).cloned();
    let title = args.iter().position(|a| a == "--title").and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| "Agentic Coder".into());
    tauri::Builder::default()
        .setup(move |app| {
            let target = match &url {
                Some(u) => WebviewUrl::External(u.parse().expect("--url is not an address")),
                None => WebviewUrl::App("index.html".into()),
            };
            // The page draws its own title bar (design 2); the Mac's lights sit over its left end.
            WebviewWindowBuilder::new(app, "main", target)
                .title(&title)
                .inner_size(1340.0, 860.0)
                .min_inner_size(900.0, 560.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .build()?;
            Ok(())
        })
        // A file dragged onto the window (a screenshot, say): the webview keeps a drop's paths from the page,
        // so they are handed to it here, and it passes them on as Terminal would type them (ui.html agenticDropped).
        // A window that is one webview gets the drop as a window event, not a webview one (tauri-runtime-wry).
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let list: Vec<String> = paths.iter().map(|p| js_string(&p.to_string_lossy())).collect();
                if let (false, Some(webview)) = (list.is_empty(), window.get_webview_window(window.label())) {
                    let _ = webview.eval(format!("window.agenticDropped && window.agenticDropped([{}])", list.join(",")));
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Agentic Coder's window could not start");
}
