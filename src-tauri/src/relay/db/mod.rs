mod contacts;
mod messages;
mod outbox;
mod threads;

pub use contacts::*;
pub use messages::*;
pub use outbox::*;
pub use threads::*;

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> crate::db::Database {
        crate::db::Database::new_in_memory().expect("failed to create in-memory db")
    }

    fn make_contact(id: &str, peer_id: &str) -> ContactRow {
        ContactRow {
            id: id.to_string(),
            peer_id: peer_id.to_string(),
            public_key: format!("pk_{}", peer_id),
            display_name: format!("User {}", id),
            agent_name: String::new(),
            agent_description: String::new(),
            local_agent_id: None,
            mode: "secretary".to_string(),
            capabilities_json: r#"{"can_send_messages":true}"#.to_string(),
            status: "pending".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_thread(id: &str, contact_id: &str) -> PeerThreadRow {
        PeerThreadRow {
            id: id.to_string(),
            contact_id: contact_id.to_string(),
            local_agent_id: None,
            title: String::new(),
            summary: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_message(id: &str, thread_id: &str, unique_id: &str) -> PeerMessageRow {
        PeerMessageRow {
            id: id.to_string(),
            thread_id: thread_id.to_string(),
            message_id_unique: unique_id.to_string(),
            correlation_id: None,
            direction: "outbound".to_string(),
            sender_agent: String::new(),
            content: "hello".to_string(),
            approval_state: "none".to_string(),
            delivery_state: "pending".to_string(),
            retry_count: 0,
            raw_envelope: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_outbox(id: &str, msg_id: &str, target: &str) -> OutboxRow {
        OutboxRow {
            id: id.to_string(),
            peer_message_id: msg_id.to_string(),
            target_peer_id: target.to_string(),
            attempts: 0,
            next_retry_at: None,
            status: "pending".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    // ── Contact tests ──

    #[test]
    fn test_insert_and_list_contacts() {
        let db = setup_db();
        let c1 = make_contact("c1", "peer1");
        let c2 = make_contact("c2", "peer2");

        insert_contact(&db, &c1).unwrap();
        insert_contact(&db, &c2).unwrap();

        let contacts = list_contacts(&db).unwrap();
        assert_eq!(contacts.len(), 2);
    }

    #[test]
    fn test_get_contact_by_peer_id() {
        let db = setup_db();
        let c = make_contact("c1", "peer-abc");
        insert_contact(&db, &c).unwrap();

        let found = get_contact_by_peer_id(&db, "peer-abc").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().display_name, "User c1");

        let not_found = get_contact_by_peer_id(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_update_contact() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        update_contact(
            &db,
            "c1",
            ContactUpdate {
                display_name: Some("New Name".to_string()),
                status: Some("accepted".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact_by_peer_id(&db, "peer1").unwrap().unwrap();
        assert_eq!(found.display_name, "New Name");
        assert_eq!(found.status, "accepted");
    }

    #[test]
    fn test_delete_contact() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        delete_contact(&db, "c1").unwrap();

        let contacts = list_contacts(&db).unwrap();
        assert!(contacts.is_empty());
    }

    #[test]
    fn test_duplicate_peer_id_rejected() {
        let db = setup_db();
        let c1 = make_contact("c1", "same-peer");
        let mut c2 = make_contact("c2", "same-peer");
        c2.public_key = "pk_other".to_string();

        insert_contact(&db, &c1).unwrap();
        let result = insert_contact(&db, &c2);
        assert!(result.is_err(), "duplicate peer_id should be rejected");
    }

    // ── Thread tests ──

    #[test]
    fn test_create_and_list_threads() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        let t1 = make_thread("t1", "c1");
        let t2 = make_thread("t2", "c1");
        create_thread(&db, &t1).unwrap();
        create_thread(&db, &t2).unwrap();

        let threads = list_threads_for_contact(&db, "c1").unwrap();
        assert_eq!(threads.len(), 2);
    }

    #[test]
    fn test_get_thread() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let found = get_thread(&db, "t1").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().contact_id, "c1");

        let not_found = get_thread(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    // ── Message tests ──

    #[test]
    fn test_insert_and_get_messages() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let m = make_message("m1", "t1", "uniq-1");
        let inserted = insert_peer_message(&db, &m).unwrap();
        assert!(inserted);

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "hello");
    }

    #[test]
    fn test_duplicate_message_idempotent() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let m = make_message("m1", "t1", "uniq-1");
        assert!(insert_peer_message(&db, &m).unwrap());

        // Same message_id_unique — should return false (not inserted)
        let m2 = make_message("m2", "t1", "uniq-1");
        assert!(!insert_peer_message(&db, &m2).unwrap());

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs.len(), 1);
    }

    #[test]
    fn test_update_message_state() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        update_message_state(&db, "m1", Some("approved"), Some("sent")).unwrap();

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs[0].approval_state, "approved");
        assert_eq!(msgs[0].delivery_state, "sent");
    }

    // ── Outbox tests ──

    #[test]
    fn test_outbox_crud() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        let o = make_outbox("o1", "m1", "peer1");
        insert_outbox(&db, &o).unwrap();

        let pending = get_pending_outbox(&db).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].target_peer_id, "peer1");

        // Update status to sent
        update_outbox_status(&db, "o1", "sent", 1).unwrap();
        let pending = get_pending_outbox(&db).unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn test_outbox_cascades_on_message_delete() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();
        let o = make_outbox("o1", "m1", "peer1");
        insert_outbox(&db, &o).unwrap();

        // Delete the contact — cascades through threads → messages → outbox
        delete_contact(&db, "c1").unwrap();

        let pending = get_pending_outbox(&db).unwrap();
        assert!(pending.is_empty());
    }

    // ── addresses_json tests ──

    #[test]
    fn test_insert_contact_with_addresses_json() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#)
        );
    }

    #[test]
    fn test_insert_contact_without_addresses_json() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert!(found.addresses_json.is_none());
    }

    #[test]
    fn test_update_contact_addresses_json() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(Some(r#"["/ip4/5.6.7.8/tcp/9000"]"#.to_string())),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/5.6.7.8/tcp/9000"]"#)
        );
    }

    #[test]
    fn test_addresses_json_roundtrip_multiple() {
        let db = setup_db();
        let addrs = r#"["/ip4/1.2.3.4/tcp/4001","/ip6/::1/tcp/4001"]"#;
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(addrs.to_string());
        insert_contact(&db, &c).unwrap();

        let found = get_contact_by_peer_id(&db, "peer1").unwrap().unwrap();
        assert_eq!(found.addresses_json.as_deref(), Some(addrs));

        // Verify JSON parsing roundtrip
        let parsed: Vec<String> = serde_json::from_str(found.addresses_json.as_ref().unwrap()).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0], "/ip4/1.2.3.4/tcp/4001");
        assert_eq!(parsed[1], "/ip6/::1/tcp/4001");
    }

    #[test]
    fn test_duplicate_peer_id_update_addresses() {
        let db = setup_db();
        let mut c1 = make_contact("c1", "peer1");
        c1.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        c1.agent_name = "OldAgent".to_string();
        insert_contact(&db, &c1).unwrap();

        // Simulate updating existing contact when re-invited with new addresses
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(Some(r#"["/ip4/2.2.2.2/tcp/5000"]"#.to_string())),
                agent_name: Some("NewAgent".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/2.2.2.2/tcp/5000"]"#)
        );
        assert_eq!(found.agent_name, "NewAgent");
    }

    #[test]
    fn test_clear_addresses_json_with_none() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        // Re-accept with empty addresses should clear stored addresses
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(None), // tri-state: explicitly set to NULL
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert!(
            found.addresses_json.is_none(),
            "addresses_json should be cleared to NULL"
        );
    }

    #[test]
    fn test_dial_peer_no_address_scenarios() {
        let db = setup_db();

        // Scenario 1: addresses_json is None
        let c1 = make_contact("c1", "peer1");
        insert_contact(&db, &c1).unwrap();
        let contact = get_contact(&db, "c1").unwrap().unwrap();
        assert!(contact.addresses_json.is_none(), "new contact has no addresses");

        // Scenario 2: addresses_json is empty array
        let mut c2 = make_contact("c2", "peer2");
        c2.addresses_json = Some("[]".to_string());
        insert_contact(&db, &c2).unwrap();
        let contact2 = get_contact(&db, "c2").unwrap().unwrap();
        let addrs: Vec<String> =
            serde_json::from_str(contact2.addresses_json.as_ref().unwrap()).unwrap();
        assert!(addrs.is_empty(), "empty array should have no addresses");

        // Scenario 3: addresses_json has valid addresses
        let mut c3 = make_contact("c3", "peer3");
        c3.addresses_json = Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#.to_string());
        insert_contact(&db, &c3).unwrap();
        let contact3 = get_contact(&db, "c3").unwrap().unwrap();
        let addrs3: Vec<String> =
            serde_json::from_str(contact3.addresses_json.as_ref().unwrap()).unwrap();
        assert_eq!(addrs3.len(), 1, "should have one address");
    }

    #[test]
    fn test_addresses_json_not_updated_when_outer_none() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        // Update with None (outer) — should NOT touch addresses_json
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                display_name: Some("New Name".to_string()),
                addresses_json: None, // don't update
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#),
            "addresses_json should be unchanged"
        );
    }

    // ── get_contact by id ──

    #[test]
    fn test_get_contact_returns_none_for_missing() {
        let db = setup_db();
        let found = get_contact(&db, "nonexistent").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn test_get_contact_returns_all_fields() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.display_name = "Alice".to_string();
        c.agent_name = "Agent Alice".to_string();
        c.agent_description = "Desc".to_string();
        c.invite_card_raw = Some("card-raw".to_string());
        // Note: local_agent_id requires FK to agents table, so leave as None
        insert_contact(&db, &c).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(found.display_name, "Alice");
        assert_eq!(found.agent_name, "Agent Alice");
        assert_eq!(found.agent_description, "Desc");
        assert!(found.local_agent_id.is_none());
        assert_eq!(found.invite_card_raw.as_deref(), Some("card-raw"));
    }

    // ── update_contact with no fields ──

    #[test]
    fn test_update_contact_empty_update_is_noop() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        // Empty update should succeed and not change anything
        update_contact(&db, "c1", ContactUpdate::default()).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(found.display_name, "User c1");
    }

    // ── update_contact all fields ──

    #[test]
    fn test_update_contact_all_fields() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        // Create an agent for local_agent_id FK
        use crate::db::agent_operations::create_agent_impl;
        use crate::db::models::CreateAgentRequest;
        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "relay-agent".into(),
                name: "Relay Agent".into(),
                avatar: None, description: None, model: None,
                temperature: None, thinking_enabled: None, thinking_budget: None,
                is_default: None, sort_order: None,
            },
        )
        .unwrap();

        update_contact(
            &db,
            "c1",
            ContactUpdate {
                display_name: Some("Updated Name".to_string()),
                agent_name: Some("New Agent".to_string()),
                agent_description: Some("New Desc".to_string()),
                local_agent_id: Some(Some(agent.id.clone())),
                mode: Some("autonomous".to_string()),
                capabilities_json: Some(r#"{"can_tools":true}"#.to_string()),
                status: Some("accepted".to_string()),
                addresses_json: Some(Some(r#"["/ip4/10.0.0.1/tcp/80"]"#.to_string())),
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(found.display_name, "Updated Name");
        assert_eq!(found.agent_name, "New Agent");
        assert_eq!(found.agent_description, "New Desc");
        assert_eq!(found.local_agent_id.as_deref(), Some(agent.id.as_str()));
        assert_eq!(found.mode, "autonomous");
        assert_eq!(found.capabilities_json, r#"{"can_tools":true}"#);
        assert_eq!(found.status, "accepted");
        assert_eq!(found.addresses_json.as_deref(), Some(r#"["/ip4/10.0.0.1/tcp/80"]"#));
    }

    // ── Thread operations ──

    #[test]
    fn test_list_threads_empty_for_contact() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let threads = list_threads_for_contact(&db, "c1").unwrap();
        assert!(threads.is_empty());
    }

    // ── Recent messages ──

    #[test]
    fn test_get_thread_messages_recent_limit() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        // Insert 5 messages with sequential timestamps
        for i in 0..5 {
            let mut m = make_message(&format!("m{i}"), "t1", &format!("uniq-{i}"));
            m.created_at = format!("2024-01-0{}T00:00:00Z", i + 1);
            insert_peer_message(&db, &m).unwrap();
        }

        let all = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(all.len(), 5);

        let recent = get_thread_messages_recent(&db, "t1", 3).unwrap();
        assert_eq!(recent.len(), 3);
        // Should be the 3 most recent, in ascending order
        assert_eq!(recent[0].id, "m2");
        assert_eq!(recent[1].id, "m3");
        assert_eq!(recent[2].id, "m4");
    }

    // ── get_peer_message ──

    #[test]
    fn test_get_peer_message_found_and_not_found() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        let found = get_peer_message(&db, "m1").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().message_id_unique, "uniq-1");

        let not_found = get_peer_message(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    // ── get_message_by_unique_id ──

    #[test]
    fn test_get_message_by_unique_id() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-abc");
        insert_peer_message(&db, &m).unwrap();

        let found = get_message_by_unique_id(&db, "uniq-abc").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "m1");

        let not_found = get_message_by_unique_id(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    // ── update_message_state partial ──

    #[test]
    fn test_update_message_state_partial_approval_only() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        update_message_state(&db, "m1", Some("approved"), None).unwrap();

        let msg = get_peer_message(&db, "m1").unwrap().unwrap();
        assert_eq!(msg.approval_state, "approved");
        assert_eq!(msg.delivery_state, "pending"); // unchanged
    }

    #[test]
    fn test_update_message_state_partial_delivery_only() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        update_message_state(&db, "m1", None, Some("delivered")).unwrap();

        let msg = get_peer_message(&db, "m1").unwrap().unwrap();
        assert_eq!(msg.approval_state, "none"); // unchanged
        assert_eq!(msg.delivery_state, "delivered");
    }

    // ── Outbox operations ──

    #[test]
    fn test_get_outbox_by_message_id() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();
        let o = make_outbox("o1", "m1", "peer1");
        insert_outbox(&db, &o).unwrap();

        let found = get_outbox_by_message_id(&db, "m1").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "o1");

        let not_found = get_outbox_by_message_id(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_update_outbox_retry() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        let mut o = make_outbox("o1", "m1", "peer1");
        o.status = "sending".to_string();
        insert_outbox(&db, &o).unwrap();

        // Mark for retry
        update_outbox_retry(&db, "o1", 2, "2025-01-01T00:00:00Z").unwrap();

        let found = get_outbox_by_message_id(&db, "m1").unwrap().unwrap();
        assert_eq!(found.status, "pending"); // back to pending
        assert_eq!(found.attempts, 2);
        assert_eq!(found.next_retry_at.as_deref(), Some("2025-01-01T00:00:00Z"));
    }

    // ── Raw envelope update ──

    #[test]
    fn test_update_message_raw_envelope() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        update_message_raw_envelope(&db, "m1", r#"{"encrypted":"data"}"#).unwrap();

        let msg = get_peer_message(&db, "m1").unwrap().unwrap();
        assert_eq!(msg.raw_envelope.as_deref(), Some(r#"{"encrypted":"data"}"#));
    }

    // ── Invite card update ──

    #[test]
    fn test_update_contact_invite_and_key() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        update_contact_invite_and_key(&db, "c1", "new-card-raw", "new-public-key").unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(found.invite_card_raw.as_deref(), Some("new-card-raw"));
        assert_eq!(found.public_key, "new-public-key");
    }

    // ── Message with correlation_id ──

    #[test]
    fn test_message_with_correlation_id() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let mut m = make_message("m1", "t1", "uniq-1");
        m.correlation_id = Some("corr-123".to_string());
        insert_peer_message(&db, &m).unwrap();

        let found = get_peer_message(&db, "m1").unwrap().unwrap();
        assert_eq!(found.correlation_id.as_deref(), Some("corr-123"));
    }
}
