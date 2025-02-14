function getPoolNodesObject(poolMap) {
  const poolNodes = Array.from(poolMap.values()).map(client => {
    return {
      id: client.id || '',
      node_version: client.node_version || '',
      execution_client: client.execution_client || '',
      consensus_client: client.consensus_client || '',
      cpu_usage: client.cpu_usage || '',
      memory_usage: client.memory_usage || '',
      storage_usage: client.storage_usage || '',
      block_number: client.block_number || '',
      block_hash: client.block_hash || '',
      execution_peers: client.execution_peers || '',
      consensus_peers: client.consensus_peers || '',
      git_branch: client.git_branch || '',
      last_commit: client.last_commit || '',
      commit_hash: client.commit_hash || '',
      enode: client.enode || '',
      peerid: client.peerid || '',
      enr: client.enr || '',
      consensus_tcp_port: client.consensus_tcp_port || '',
      consensus_udp_port: client.consensus_udp_port || '',
      socket_id: {
        id: client.wsID || ''
      },
      owner: client.owner || ''
    };
  });

  return poolNodes;
}

module.exports = { getPoolNodesObject };
