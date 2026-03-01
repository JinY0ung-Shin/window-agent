use headless_chrome::{Browser, LaunchOptions, Tab};
use std::sync::{Arc, Mutex, OnceLock};

struct BrowserState {
    #[allow(dead_code)]
    browser: Browser,
    current_tab: Arc<Tab>,
}

fn browser_state() -> &'static Mutex<Option<BrowserState>> {
    static INSTANCE: OnceLock<Mutex<Option<BrowserState>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

pub struct BrowserManager;

impl BrowserManager {
    /// Launch a headless Chrome browser and create an initial tab.
    pub fn launch() -> Result<(), String> {
        let mut guard = browser_state()
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        if guard.is_some() {
            return Ok(());
        }

        let launch_options = LaunchOptions::default_builder()
            .headless(true)
            .sandbox(false)
            .build()
            .map_err(|e| format!("Failed to build launch options: {}", e))?;

        let browser =
            Browser::new(launch_options).map_err(|e| format!("Failed to launch browser: {}", e))?;

        let tab = browser
            .new_tab()
            .map_err(|e| format!("Failed to create tab: {}", e))?;

        *guard = Some(BrowserState {
            browser,
            current_tab: tab,
        });

        Ok(())
    }

    /// Ensure browser is running; launch if not.
    pub fn ensure_running() -> Result<(), String> {
        {
            let guard = browser_state()
                .lock()
                .map_err(|e| format!("Lock poisoned: {}", e))?;
            if guard.is_some() {
                return Ok(());
            }
        }
        Self::launch()
    }

    /// Run a closure with the current tab.
    pub fn with_tab<F, R>(f: F) -> Result<R, String>
    where
        F: FnOnce(&Arc<Tab>) -> Result<R, String>,
    {
        let guard = browser_state()
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        match guard.as_ref() {
            Some(state) => f(&state.current_tab),
            None => Err("Browser not running. Navigate to a URL first.".to_string()),
        }
    }

    /// Shutdown the browser.
    pub fn shutdown() -> Result<(), String> {
        let mut guard = browser_state()
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = None;
        Ok(())
    }

    /// Check if the browser is running.
    pub fn is_running() -> bool {
        browser_state()
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }
}
