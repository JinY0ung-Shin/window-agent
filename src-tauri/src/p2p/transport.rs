use libp2p::{identity::Keypair, swarm::Swarm};
use std::time::Duration;

use super::protocol::AgentBehaviour;

/// Build a libp2p Swarm with TCP + Noise + Yamux transport and AgentBehaviour.
pub fn build_swarm(
    keypair: Keypair,
) -> Result<Swarm<AgentBehaviour>, Box<dyn std::error::Error + Send + Sync>> {
    let swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            libp2p::tcp::Config::default(),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_behaviour(AgentBehaviour::new)?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    Ok(swarm)
}
