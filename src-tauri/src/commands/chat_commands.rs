use crate::db::models::{Conversation, Message, SaveMessageRequest};
use crate::db::operations;
use crate::db::Database;
use tauri::State;

#[tauri::command]
pub fn create_conversation(
    db: State<'_, Database>,
    title: Option<String>,
    agent_id: String,
) -> Result<Conversation, String> {
    Ok(operations::create_conversation_impl(&db, title, agent_id)?)
}

#[tauri::command]
pub fn get_conversations(db: State<'_, Database>) -> Result<Vec<Conversation>, String> {
    Ok(operations::get_conversations_impl(&db)?)
}

#[tauri::command]
pub fn get_messages(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    Ok(operations::get_messages_impl(&db, conversation_id)?)
}

#[tauri::command]
pub fn save_message(
    db: State<'_, Database>,
    request: SaveMessageRequest,
) -> Result<Message, String> {
    Ok(operations::save_message_impl(&db, request)?)
}

#[tauri::command]
pub fn delete_conversation(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<(), String> {
    Ok(operations::delete_conversation_impl(&db, conversation_id)?)
}
