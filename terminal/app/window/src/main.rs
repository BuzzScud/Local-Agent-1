// The window: one webview on the window server's page. `--url <address>` is the page to open (the
// window server gives it, with its key); without one it shows the stub until it is told.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

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
        .run(tauri::generate_context!())
        .expect("Agentic Coder's window could not start");
}
