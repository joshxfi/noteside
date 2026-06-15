// Noteside desktop backend.
//
// Files-as-truth: notes are plain Markdown files in a user-chosen vault folder.
// A rebuildable in-memory index (see `state`/`vault`) powers listing + search;
// FTS5/SQLite is the documented upgrade path for very large vaults.
//
// The window is decorationless; the React titlebar drives close/minimize/maximize
// through the core window APIs authorized in `capabilities/default.json`.

mod commands;
mod error;
mod models;
mod search;
mod state;
mod vault;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered first: focus the existing window if a
    // second launch is attempted (also avoids two instances racing on the vault).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::current_vault,
            commands::list_notes,
            commands::read_note,
            commands::save_note,
            commands::create_note,
            commands::delete_note,
            commands::search_files,
            commands::search_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
