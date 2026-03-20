use libp2p::{
    mdns, request_response, relay, dcutr, autonat,
    swarm::NetworkBehaviour,
    StreamProtocol,
};

use super::envelope::Envelope;

pub const AGENT_PROTOCOL: &str = "/window-agent/p2p/1.0.0";

#[derive(NetworkBehaviour)]
pub struct AgentBehaviour {
    pub request_response: request_response::json::Behaviour<Envelope, Envelope>,
    pub mdns: mdns::tokio::Behaviour,
    pub relay_client: relay::client::Behaviour,
    pub dcutr: dcutr::Behaviour,
    pub autonat: autonat::Behaviour,
}

impl AgentBehaviour {
    pub fn new(
        keypair: &libp2p::identity::Keypair,
        relay_client: relay::client::Behaviour,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let protocol = StreamProtocol::new(AGENT_PROTOCOL);
        let request_response = request_response::json::Behaviour::new(
            [(protocol, request_response::ProtocolSupport::Full)],
            request_response::Config::default(),
        );

        let mdns = mdns::tokio::Behaviour::new(
            mdns::Config::default(),
            keypair.public().to_peer_id(),
        )?;

        let dcutr = dcutr::Behaviour::new(keypair.public().to_peer_id());
        let autonat = autonat::Behaviour::new(
            keypair.public().to_peer_id(),
            Default::default(),
        );

        Ok(Self {
            request_response,
            mdns,
            relay_client,
            dcutr,
            autonat,
        })
    }
}
