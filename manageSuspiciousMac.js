#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SUSPICIOUS_MAC_FILE = path.join(__dirname, 'suspiciousMacAddresses.json');

function loadSuspiciousMacAddresses() {
  try {
    const data = fs.readFileSync(SUSPICIOUS_MAC_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading suspicious MAC addresses:', error.message);
    return [];
  }
}

function saveSuspiciousMacAddresses(macAddresses) {
  try {
    fs.writeFileSync(SUSPICIOUS_MAC_FILE, JSON.stringify(macAddresses, null, 2));
    console.log(`✅ Saved ${macAddresses.length} suspicious MAC addresses to ${SUSPICIOUS_MAC_FILE}`);
  } catch (error) {
    console.error('Error saving suspicious MAC addresses:', error.message);
  }
}

function addMacAddress(macAddress) {
  const macAddresses = loadSuspiciousMacAddresses();
  const normalizedMac = macAddress.toLowerCase();
  
  if (macAddresses.includes(normalizedMac)) {
    console.log(`⚠️  MAC address ${normalizedMac} is already in the suspicious list`);
    return;
  }
  
  macAddresses.push(normalizedMac);
  saveSuspiciousMacAddresses(macAddresses);
  console.log(`✅ Added ${normalizedMac} to suspicious MAC addresses list`);
}

function removeMacAddress(macAddress) {
  const macAddresses = loadSuspiciousMacAddresses();
  const normalizedMac = macAddress.toLowerCase();
  const index = macAddresses.indexOf(normalizedMac);
  
  if (index === -1) {
    console.log(`⚠️  MAC address ${normalizedMac} is not in the suspicious list`);
    return;
  }
  
  macAddresses.splice(index, 1);
  saveSuspiciousMacAddresses(macAddresses);
  console.log(`✅ Removed ${normalizedMac} from suspicious MAC addresses list`);
}

function listMacAddresses() {
  const macAddresses = loadSuspiciousMacAddresses();
  console.log(`\n📋 Suspicious MAC Addresses (${macAddresses.length}):`);
  if (macAddresses.length === 0) {
    console.log('   (none)');
  } else {
    macAddresses.forEach((mac, index) => {
      console.log(`   ${index + 1}. ${mac}`);
    });
  }
  console.log('');
}

function showUsage() {
  console.log(`
Usage: node manageSuspiciousMac.js [command] [mac_address]

Commands:
  add <mac_address>     Add a MAC address to the suspicious list
  remove <mac_address>  Remove a MAC address from the suspicious list
  list                  List all suspicious MAC addresses
  help                  Show this help message

Examples:
  node manageSuspiciousMac.js add f8:75:a4:04:05:c3
  node manageSuspiciousMac.js remove f8:75:a4:04:05:c3
  node manageSuspiciousMac.js list
`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const macAddress = args[1];

switch (command) {
  case 'add':
    if (!macAddress) {
      console.error('❌ Please provide a MAC address to add');
      showUsage();
      process.exit(1);
    }
    addMacAddress(macAddress);
    break;
    
  case 'remove':
    if (!macAddress) {
      console.error('❌ Please provide a MAC address to remove');
      showUsage();
      process.exit(1);
    }
    removeMacAddress(macAddress);
    break;
    
  case 'list':
    listMacAddresses();
    break;
    
  case 'help':
  case '--help':
  case '-h':
    showUsage();
    break;
    
  default:
    console.error('❌ Unknown command:', command);
    showUsage();
    process.exit(1);
} 