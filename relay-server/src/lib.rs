pub mod db;
pub mod state;
pub mod ws;

use axum::{
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use sqlx::sqlite::SqlitePoolOptions;

use state::AppState;

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws::handle_socket(socket, state))
}

async fn health() -> &'static str {
    "ok"
}

/// Build the axum Router (public for integration tests).
pub async fn build_app(database_url: &str) -> (Router, AppState) {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .expect("Failed to connect to SQLite");

    db::init_db(&pool).await.expect("Failed to initialize DB");

    let state = AppState::new(pool);
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health))
        .with_state(state.clone());

    (app, state)
}
