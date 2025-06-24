# Suspicious MAC Address Management

This feature allows you to automatically mark nodes as suspicious based on their MAC addresses. Nodes with suspicious MAC addresses will be excluded from RPC request routing but will still remain connected to monitor their behavior.

## Files

- `suspiciousMacAddresses.json` - Contains the list of suspicious MAC addresses
- `utils/suspiciousMacChecker.js` - Utility functions for checking suspicious MAC addresses
- `manageSuspiciousMac.js` - CLI tool for managing the suspicious MAC addresses list

## Management Script Usage

```bash
# List all suspicious MAC addresses
node manageSuspiciousMac.js list

# Add a MAC address to the suspicious list
node manageSuspiciousMac.js add f8:75:a4:04:05:c3

# Remove a MAC address from the suspicious list
node manageSuspiciousMac.js remove f8:75:a4:04:05:c3

# Show help
node manageSuspiciousMac.js help
```

## API Endpoints

### Get Suspicious MAC Addresses
```bash
curl https://pool.mainnet.rpc.buidlguidl.com:3003/suspiciousMacAddresses
```

### Get Suspicious Nodes (includes MAC addresses and reasons)
```bash
curl https://pool.mainnet.rpc.buidlguidl.com:3003/suspiciousNodes
```

### Reload Suspicious MAC Addresses (without restarting the service)
```bash
curl -X POST https://pool.mainnet.rpc.buidlguidl.com:3003/reloadSuspiciousMacAddresses
```

## How It Works

1. When a node connects via Socket.IO and sends a `checkin` message, the system extracts the MAC address from the `machine_id` field
2. The MAC address is checked against the suspicious list in `suspiciousMacAddresses.json`
3. If the MAC address is found in the list, the node is automatically marked as suspicious
4. Suspicious nodes are excluded from RPC request routing but remain connected for monitoring
5. The system logs when suspicious nodes are detected and sends Telegram alerts

## MAC Address Extraction

The system extracts MAC addresses from `machine_id` fields with the format:
```
thebuidl-ThinkCentre-M710q-f8:75:a4:04:05:c3-linux-x64
                            ^^^^^^^^^^^^^^^^^
                            MAC address part
```

## Notes

- MAC addresses are stored and compared in lowercase for consistency
- Nodes can be suspicious for multiple reasons (MAC address, block number deviation, etc.)
- The suspicious MAC addresses list can be updated without restarting the pool service by using the reload endpoint
- Changes to the `suspiciousMacAddresses.json` file can be managed through the CLI script or by editing the file directly 