use std::path::Path;

fn main() {
    // Ensure browser-sidecar/node.exe exists so Tauri's resource validation passes.
    // On Windows release builds a real Node binary is placed here; on other platforms
    // (or fresh clones) we create an empty placeholder that the runtime resolver
    // (resolve_node_executable) will detect and skip, falling back to system PATH.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let node_exe = Path::new(&manifest_dir).join("../browser-sidecar/node.exe");
    if !node_exe.exists() {
        if let Some(parent) = node_exe.parent() {
            std::fs::create_dir_all(parent)
                .expect("Failed to create browser-sidecar directory for node.exe placeholder");
        }
        std::fs::File::create(&node_exe)
            .expect("Failed to create node.exe placeholder for Tauri resource validation");
    }

    tauri_build::build()
}
