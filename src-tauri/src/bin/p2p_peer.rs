//! CLI test peer for P2P connection testing.
//!
//! Usage:
//!   cargo run --bin p2p-peer                    # 기본: mDNS 자동 발견
//!   cargo run --bin p2p-peer -- --port 9001     # 특정 포트 지정
//!
//! 실행 후 대화형 명령어:
//!   invite              — 초대 코드 생성
//!   accept <code>       — 초대 코드 수락 + 연결
//!   send <peer> <msg>   — 메시지 전송
//!   peers               — 연결된 피어 목록
//!   quit                — 종료

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use futures::StreamExt;
use libp2p::{mdns, request_response, swarm::SwarmEvent, Multiaddr, PeerId};
use tokio::io::{AsyncBufReadExt, BufReader};

// Reuse project modules
use tauri_app_lib::p2p::contact_card::ContactCard;
use tauri_app_lib::p2p::envelope::{Envelope, Payload};
use tauri_app_lib::p2p::identity::NodeIdentity;
use tauri_app_lib::p2p::invite;
use tauri_app_lib::p2p::protocol::{AgentBehaviour, AgentBehaviourEvent};
use tauri_app_lib::p2p::security::{HandshakeMessage, HandshakeState};

fn build_swarm(
    keypair: libp2p::identity::Keypair,
) -> Result<libp2p::Swarm<AgentBehaviour>, Box<dyn std::error::Error>> {
    let swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            libp2p::tcp::Config::default(),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_relay_client(
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_behaviour(|keypair, relay_client| AgentBehaviour::new(keypair, relay_client))?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(120)))
        .build();
    Ok(swarm)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse args
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = args
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // Generate identity
    let identity = NodeIdentity::generate();
    let local_peer_id = *identity.peer_id();
    println!("=== P2P Test Peer ===");
    println!("PeerId: {local_peer_id}");

    let mut swarm = build_swarm(identity.keypair().clone())?;

    // Listen
    let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{port}").parse()?;
    swarm.listen_on(listen_addr)?;

    let mut known_peers: HashSet<String> = HashSet::new();
    let mut authenticated_peers: HashSet<String> = HashSet::new();
    let mut pending_handshakes: HashMap<String, (HandshakeState, Instant)> = HashMap::new();
    let mut peer_names: HashMap<String, String> = HashMap::new(); // peer_id -> name

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    println!("\n명령어: invite | accept <code> | send <peer_id_prefix> <message> | peers | quit\n");

    loop {
        tokio::select! {
            event = swarm.select_next_some() => {
                handle_event(
                    &mut swarm,
                    event,
                    &identity,
                    &mut known_peers,
                    &mut authenticated_peers,
                    &mut pending_handshakes,
                    &mut peer_names,
                );
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(input)) => {
                        let input = input.trim().to_string();
                        if input.is_empty() { continue; }
                        if input == "quit" || input == "exit" {
                            println!("종료합니다.");
                            break;
                        }
                        handle_command(
                            &input,
                            &mut swarm,
                            &identity,
                            &mut known_peers,
                            &authenticated_peers,
                            &mut peer_names,
                        ).await;
                    }
                    Ok(None) => break,
                    Err(e) => { eprintln!("stdin error: {e}"); break; }
                }
            }
        }
    }

    Ok(())
}

fn handle_event(
    swarm: &mut libp2p::Swarm<AgentBehaviour>,
    event: SwarmEvent<AgentBehaviourEvent>,
    identity: &NodeIdentity,
    known_peers: &mut HashSet<String>,
    authenticated_peers: &mut HashSet<String>,
    pending_handshakes: &mut HashMap<String, (HandshakeState, Instant)>,
    peer_names: &mut HashMap<String, String>,
) {
    match event {
        SwarmEvent::NewListenAddr { address, .. } => {
            println!("[listen] {address}");
        }
        SwarmEvent::Behaviour(AgentBehaviourEvent::Mdns(mdns::Event::Discovered(peers))) => {
            for (peer_id, addr) in peers {
                swarm.add_peer_address(peer_id, addr.clone());
                let peer_str = peer_id.to_string();
                if known_peers.contains(&peer_str) && !authenticated_peers.contains(&peer_str) {
                    println!("[mdns] 알려진 피어 발견: {peer_str} @ {addr} — 다이얼 시도");
                    let _ = swarm.dial(peer_id);
                }
            }
        }
        SwarmEvent::Behaviour(AgentBehaviourEvent::Mdns(mdns::Event::Expired(_))) => {}

        // Request handler
        SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
            request_response::Event::Message { peer, message: request_response::Message::Request { request, channel, .. } },
        )) => {
            let peer_str = peer.to_string();
            let is_known = known_peers.contains(&peer_str);

            match &request.payload {
                Payload::Handshake { data } => {
                    if !is_known {
                        println!("[handshake] 알 수 없는 피어에서 핸드셰이크: {peer_str}");
                        return;
                    }
                    let hs_msg: HandshakeMessage = match serde_json::from_str(data) {
                        Ok(m) => m,
                        Err(e) => { eprintln!("[handshake] 파싱 실패: {e}"); return; }
                    };

                    let (state, _) = pending_handshakes
                        .entry(peer_str.clone())
                        .or_insert_with(|| (HandshakeState::new_responder(), Instant::now()));

                    match state.process_message(hs_msg, identity) {
                        Ok(Some(reply_msg)) => {
                            let reply_data = serde_json::to_string(&reply_msg).unwrap_or_default();
                            let reply = Envelope::new(
                                swarm.local_peer_id().to_string(),
                                Payload::Handshake { data: reply_data },
                            );
                            let _ = swarm.behaviour_mut().request_response.send_response(channel, reply);

                            if state.is_complete() {
                                pending_handshakes.remove(&peer_str);
                                if authenticated_peers.insert(peer_str.clone()) {
                                    let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                                    println!("[auth] ✓ 핸드셰이크 완료 (responder): {name}");
                                }
                            }
                        }
                        Ok(None) => {
                            pending_handshakes.remove(&peer_str);
                            let ack = Envelope::new("cli-peer".into(), Payload::Ack { acked_message_id: request.message_id.clone() });
                            let _ = swarm.behaviour_mut().request_response.send_response(channel, ack);
                            if authenticated_peers.insert(peer_str.clone()) {
                                let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                                println!("[auth] ✓ 핸드셰이크 완료 (responder): {name}");
                            }
                        }
                        Err(e) => {
                            eprintln!("[handshake] 에러: {e}");
                            pending_handshakes.remove(&peer_str);
                        }
                    }
                }
                Payload::MessageRequest { content } => {
                    if !authenticated_peers.contains(&peer_str) {
                        println!("[msg] 인증 안 된 피어에서 메시지 거부: {peer_str}");
                        return;
                    }
                    let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                    println!("[msg] ← {name}: {content}");
                    let ack = Envelope::new("cli-peer".into(), Payload::Ack { acked_message_id: request.message_id.clone() });
                    let _ = swarm.behaviour_mut().request_response.send_response(channel, ack);
                }
                Payload::MessageResponse { content } => {
                    let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                    println!("[resp] ← {name}: {content}");
                    let ack = Envelope::new("cli-peer".into(), Payload::Ack { acked_message_id: request.message_id.clone() });
                    let _ = swarm.behaviour_mut().request_response.send_response(channel, ack);
                }
                _ => {
                    let ack = Envelope::new("cli-peer".into(), Payload::Ack { acked_message_id: request.message_id.clone() });
                    let _ = swarm.behaviour_mut().request_response.send_response(channel, ack);
                }
            }
        }

        // Response handler
        SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
            request_response::Event::Message { peer, message: request_response::Message::Response { response, .. } },
        )) => {
            let peer_str = peer.to_string();

            if let Payload::Handshake { ref data } = response.payload {
                let hs_msg: HandshakeMessage = match serde_json::from_str(data) {
                    Ok(m) => m,
                    Err(_) => { pending_handshakes.remove(&peer_str); return; }
                };
                let (state, _) = match pending_handshakes.get_mut(&peer_str) {
                    Some(s) => s,
                    None => return,
                };
                match state.process_message(hs_msg, identity) {
                    Ok(Some(next_msg)) => {
                        let next_data = serde_json::to_string(&next_msg).unwrap_or_default();
                        let envelope = Envelope::new(
                            swarm.local_peer_id().to_string(),
                            Payload::Handshake { data: next_data },
                        );
                        swarm.behaviour_mut().request_response.send_request(&peer, envelope);
                    }
                    Ok(None) => {
                        pending_handshakes.remove(&peer_str);
                        if authenticated_peers.insert(peer_str.clone()) {
                            let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                            println!("[auth] ✓ 핸드셰이크 완료 (initiator): {name}");
                        }
                    }
                    Err(e) => {
                        eprintln!("[handshake] 에러: {e}");
                        pending_handshakes.remove(&peer_str);
                    }
                }
                return;
            }

            if let Payload::Ack { ref acked_message_id } = response.payload {
                println!("[ack] 메시지 전달 확인: {}", &acked_message_id[..8]);
            }
        }

        SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
            request_response::Event::OutboundFailure { peer, error, .. },
        )) => {
            eprintln!("[error] {peer} 전송 실패: {error}");
        }

        SwarmEvent::ConnectionEstablished { peer_id, .. } => {
            let peer_str = peer_id.to_string();
            if known_peers.contains(&peer_str) && !authenticated_peers.contains(&peer_str)
                && !pending_handshakes.contains_key(&peer_str)
            {
                println!("[conn] 연결됨, 핸드셰이크 시작: {}", &peer_str[..16]);
                let (state, challenge_msg) = HandshakeState::new_initiator(identity);
                pending_handshakes.insert(peer_str.clone(), (state, Instant::now()));
                let data = serde_json::to_string(&challenge_msg).unwrap_or_default();
                let envelope = Envelope::new(
                    swarm.local_peer_id().to_string(),
                    Payload::Handshake { data },
                );
                swarm.behaviour_mut().request_response.send_request(&peer_id, envelope);
            }
        }
        SwarmEvent::ConnectionClosed { peer_id, .. } => {
            let peer_str = peer_id.to_string();
            if !swarm.is_connected(&peer_id) {
                authenticated_peers.remove(&peer_str);
                pending_handshakes.remove(&peer_str);
                let name = peer_names.get(&peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                println!("[disc] 연결 끊김: {name}");
            }
        }
        _ => {}
    }
}

async fn handle_command(
    input: &str,
    swarm: &mut libp2p::Swarm<AgentBehaviour>,
    identity: &NodeIdentity,
    known_peers: &mut HashSet<String>,
    authenticated_peers: &HashSet<String>,
    peer_names: &mut HashMap<String, String>,
) {
    let parts: Vec<&str> = input.splitn(3, ' ').collect();
    match parts[0] {
        "invite" => {
            // Collect listen addresses
            let addrs: Vec<String> = swarm
                .listeners()
                .map(|a| a.to_string())
                .collect();
            match invite::generate_invite(
                identity,
                addrs,
                "CLI-Test-Peer".into(),
                "P2P test peer".into(),
                Some(24),
            ) {
                Ok(code) => {
                    println!("\n=== 초대 코드 (상대방에게 전달) ===");
                    println!("{code}");
                    println!("===================================\n");
                }
                Err(e) => eprintln!("초대 생성 실패: {e}"),
            }
        }
        "accept" if parts.len() >= 2 => {
            let code = parts[1].trim();
            match invite::parse_invite(code) {
                Ok(card) => {
                    println!("[accept] 피어: {} ({})", card.agent_name, &card.peer_id[..16]);
                    known_peers.insert(card.peer_id.clone());
                    peer_names.insert(card.peer_id.clone(), card.agent_name.clone());

                    // Dial
                    let addrs: Vec<Multiaddr> = card.addresses.iter()
                        .filter_map(|a| a.parse().ok())
                        .collect();
                    if !addrs.is_empty() {
                        if let Ok(peer_id) = card.peer_id.parse::<PeerId>() {
                            for addr in &addrs {
                                swarm.add_peer_address(peer_id, addr.clone());
                            }
                            match swarm.dial(peer_id) {
                                Ok(_) => println!("[dial] 연결 시도 중..."),
                                Err(e) => eprintln!("[dial] 실패: {e}"),
                            }
                        }
                    } else {
                        println!("[accept] 주소 없음 — mDNS 발견 대기 중...");
                    }
                }
                Err(e) => eprintln!("초대 코드 파싱 실패: {e}"),
            }
        }
        "send" if parts.len() >= 3 => {
            let prefix = parts[1];
            let content = parts[2];

            // Find peer by prefix
            let target = authenticated_peers.iter().find(|p| p.starts_with(prefix));
            match target {
                Some(peer_str) => {
                    if let Ok(peer_id) = peer_str.parse::<PeerId>() {
                        let envelope = Envelope::new(
                            "cli-peer".into(),
                            Payload::MessageRequest { content: content.to_string() },
                        );
                        swarm.behaviour_mut().request_response.send_request(&peer_id, envelope);
                        let name = peer_names.get(peer_str).cloned().unwrap_or_else(|| peer_str[..16].to_string());
                        println!("[msg] → {name}: {content}");
                    }
                }
                None => {
                    eprintln!("인증된 피어 중 '{prefix}'로 시작하는 피어 없음");
                    if !authenticated_peers.is_empty() {
                        println!("인증된 피어 목록:");
                        for p in authenticated_peers {
                            let name = peer_names.get(p).cloned().unwrap_or_default();
                            println!("  {}  {name}", &p[..16]);
                        }
                    }
                }
            }
        }
        "peers" => {
            println!("\n=== 피어 목록 ===");
            println!("알려진 피어: {}", known_peers.len());
            println!("인증된 피어: {}", authenticated_peers.len());
            for p in authenticated_peers {
                let name = peer_names.get(p).cloned().unwrap_or_default();
                let connected = swarm.is_connected(&p.parse::<PeerId>().unwrap());
                let status = if connected { "연결됨" } else { "끊김" };
                println!("  {} {name} [{status}]", &p[..16]);
            }
            println!("=================\n");
        }
        _ => {
            println!("명령어: invite | accept <code> | send <peer_prefix> <message> | peers | quit");
        }
    }
}
