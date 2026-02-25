/// BrowserManager placeholder for future browser automation.
/// Currently a stub with no actual browser functionality.
pub struct BrowserManager {
    running: bool,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self { running: false }
    }

    pub fn is_running(&self) -> bool {
        self.running
    }
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self::new()
    }
}
