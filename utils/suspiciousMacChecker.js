const fs = require('fs');
const path = require('path');

// Load suspicious MAC addresses from file
let suspiciousMacAddresses = [];

function loadSuspiciousMacAddresses() {
  try {
    const filePath = path.join(__dirname, '..', 'suspiciousMacAddresses.json');
    const data = fs.readFileSync(filePath, 'utf8');
    suspiciousMacAddresses = JSON.parse(data);
    console.log(`Loaded ${suspiciousMacAddresses.length} suspicious MAC addresses:`, suspiciousMacAddresses);
  } catch (error) {
    console.error('Error loading suspicious MAC addresses:', error.message);
    suspiciousMacAddresses = [];
  }
}

// Extract MAC address from machine_id
// Format: thebuidl-ThinkCentre-M710q-f8:75:a4:04:05:c3-linux-x64
function extractMacAddressFromMachineId(machineId) {
  if (!machineId || typeof machineId !== 'string') {
    return null;
  }
  
  // Look for MAC address pattern (6 groups of 2 hex digits separated by colons)
  const macPattern = /([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})/;
  const match = machineId.match(macPattern);
  
  if (match) {
    return match[1].toLowerCase(); // Return MAC address in lowercase for consistent comparison
  }
  
  return null;
}

// Check if a MAC address is in the suspicious list
function isMacAddressSuspicious(macAddress) {
  if (!macAddress) {
    return false;
  }
  
  return suspiciousMacAddresses.includes(macAddress.toLowerCase());
}

// Check if a machine_id contains a suspicious MAC address
function isMachineIdSuspicious(machineId) {
  const macAddress = extractMacAddressFromMachineId(machineId);
  return isMacAddressSuspicious(macAddress);
}

// Reload suspicious MAC addresses (useful for runtime updates)
function reloadSuspiciousMacAddresses() {
  loadSuspiciousMacAddresses();
}

// Initialize on module load
loadSuspiciousMacAddresses();

module.exports = {
  extractMacAddressFromMachineId,
  isMacAddressSuspicious,
  isMachineIdSuspicious,
  reloadSuspiciousMacAddresses,
  getSuspiciousMacAddresses: () => [...suspiciousMacAddresses] // Return copy to prevent modification
}; 