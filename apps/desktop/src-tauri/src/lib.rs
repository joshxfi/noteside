// Noteside desktop backend.
//
// The window is decorationless (`decorations: false`); the custom titlebar in
// the React UI drives close/minimize/maximize through the core window APIs,
// authorized in `capabilities/default.json`.
//
// Future work (see repo README build plan): vault scanning + atomic Markdown
// writes, a `notify` file watcher, SQLite/FTS5 via rusqlite, and the fff-search
// fuzzy palette — all exposed here as `#[tauri::command]`s.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
