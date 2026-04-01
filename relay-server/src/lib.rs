pub mod api;
pub mod auth;
pub mod db;
pub mod hub_db;
pub mod state;
pub mod web;
pub mod ws;

use axum::{
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{delete, get, post},
    Router,
};
use sqlx::sqlite::SqlitePoolOptions;
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
};

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
        .max_connections(10)
        .connect(database_url)
        .await
        .expect("Failed to connect to SQLite");

    // Enable WAL mode for better concurrent access.
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await
        .ok();
    // Enable foreign keys.
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&pool)
        .await
        .ok();

    db::init_db(&pool).await.expect("Failed to initialize DB");
    hub_db::init_hub_tables(&pool)
        .await
        .expect("Failed to initialize hub tables");

    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
        tracing::warn!("JWT_SECRET not set — using random secret (tokens won't survive restart)");
        uuid::Uuid::new_v4().to_string()
    });

    let state = AppState::new(pool, jwt_secret);

    let app = Router::new()
        // Existing relay routes
        .route("/ws", get(ws_handler))
        .route("/health", get(health))
        // Web pages (public)
        .route("/", get(web::landing))
        .route("/register", get(web::register_page).post(web::register_submit))
        .route("/login", get(web::login_page).post(web::login_submit))
        .route("/agents", get(web::agents_page))
        .route("/agents/{id}", get(web::agent_detail_page))
        .route("/skills", get(web::skills_page))
        .route("/skills/{id}", get(web::skill_detail_page))
        .route("/notes", get(web::notes_page))
        .route("/notes/{id}", get(web::note_detail_page))
        .route("/users/{id}", get(web::user_profile_page))
        // REST API — auth
        .route("/api/auth/register", post(api::register))
        .route("/api/auth/login", post(api::login))
        // REST API — me
        .route("/api/me", get(api::get_me).post(api::update_me))
        // REST API — share (auth required)
        .route("/api/share/agent", post(api::share_agent))
        .route("/api/share/skills", post(api::share_skills))
        .route("/api/share/notes", post(api::share_notes))
        // REST API — list (public)
        .route("/api/shared/agents", get(api::list_agents))
        .route("/api/shared/skills", get(api::list_skills))
        .route("/api/shared/notes", get(api::list_notes))
        // REST API — delete (auth required)
        .route("/api/shared/agents/{id}", delete(api::delete_agent))
        .route("/api/shared/skills/{id}", delete(api::delete_skill))
        .route("/api/shared/notes/{id}", delete(api::delete_note))
        // Middleware
        .layer(RequestBodyLimitLayer::new(512 * 1024)) // 512KB
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                ]),
        )
        .with_state(state.clone());

    (app, state)
}
