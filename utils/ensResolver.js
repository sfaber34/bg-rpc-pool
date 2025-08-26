const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');
const { mainnetPublicClient } = require('./mainnetPublicClient');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

let dbPool = null;

// Initialize database connection pool
async function initDbPool() {
  if (dbPool) return dbPool;

  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      throw new Error('Required environment variables are missing');
    }

    if (!fs.existsSync(RDS_CA_BUNDLE_PATH)) {
      throw new Error('RDS CA bundle not found');
    }

    const secret_name = process.env.RDS_SECRET_NAME;
    const secretsClient = new SecretsManagerClient({ 
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    });

    const command = new GetSecretValueCommand({
      SecretId: secret_name,
      VersionStage: "AWSCURRENT",
    });
    const data = await secretsClient.send(command);
    const secret = JSON.parse(data.SecretString);

    const dbConfig = {
      host: process.env.DB_HOST,
      user: secret.username,
      password: secret.password,
      database: secret.dbname || 'postgres',
      port: 5432,
      ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync(RDS_CA_BUNDLE_PATH).toString()
      }
    };

    dbPool = new Pool(dbConfig);
    return dbPool;
  } catch (error) {
    console.error('Error initializing database pool:', error);
    throw error;
  }
}

// Check if a string is an ENS name (contains .eth or other TLD)
function isEnsName(name) {
  if (!name || typeof name !== 'string') return false;
  return name.includes('.') && !name.startsWith('0x');
}

// Check if a string is an Ethereum address
function isEthereumAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return address.startsWith('0x') && address.length === 42;
}

// Resolve ENS name to address with caching
async function resolveEnsToAddress(ensName) {
  if (!isEnsName(ensName)) {
    // If it's already an address, return it as-is
    if (isEthereumAddress(ensName)) {
      return ensName;
    }
    // If it's neither ENS nor address, return as-is (could be 'unknown' or other identifier)
    return ensName;
  }

  try {
    const pool = await initDbPool();
    const client = await pool.connect();

    try {
      // First, check if we have this ENS name cached
      const cachedResult = await client.query(
        'SELECT resolved_address FROM ens_table WHERE ens_name = $1',
        [ensName.toLowerCase()]
      );

      if (cachedResult.rows.length > 0) {
        console.log(`Using cached address for ${ensName}: ${cachedResult.rows[0].resolved_address}`);
        return cachedResult.rows[0].resolved_address;
      }

      // If not cached, resolve it using mainnet client
      console.log(`Resolving ENS name: ${ensName}`);
      const address = await mainnetPublicClient.getEnsAddress({
        name: ensName
      });

      if (!address) {
        console.warn(`Could not resolve ENS name: ${ensName}`);
        return ensName; // Return original name if resolution fails
      }

      // Cache the result
      await client.query(`
        INSERT INTO ens_table (ens_name, resolved_address, created_at, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (ens_name)
        DO UPDATE SET 
          resolved_address = $2,
          updated_at = CURRENT_TIMESTAMP
      `, [ensName.toLowerCase(), address]);

      console.log(`Resolved and cached ${ensName} -> ${address}`);
      return address;

    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`Error resolving ENS name ${ensName}:`, error);
    return ensName; // Return original name if there's an error
  }
}

// Resolve multiple ENS names to addresses (batch operation)
async function resolveMultipleEnsToAddresses(ensNames) {
  const results = {};
  
  // Process in parallel for better performance
  const promises = ensNames.map(async (ensName) => {
    const address = await resolveEnsToAddress(ensName);
    results[ensName] = address;
  });

  await Promise.all(promises);
  return results;
}

// Get ENS name from address (reverse lookup from cache)
async function getEnsFromAddress(address) {
  if (!isEthereumAddress(address)) {
    return null;
  }

  try {
    const pool = await initDbPool();
    const client = await pool.connect();

    try {
      const result = await client.query(
        'SELECT ens_name FROM ens_table WHERE resolved_address = $1',
        [address]
      );

      return result.rows.length > 0 ? result.rows[0].ens_name : null;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`Error looking up ENS for address ${address}:`, error);
    return null;
  }
}

// Close the database pool
async function closeDbPool() {
  if (dbPool) {
    await dbPool.end();
    dbPool = null;
  }
}

module.exports = {
  resolveEnsToAddress,
  resolveMultipleEnsToAddresses,
  getEnsFromAddress,
  isEnsName,
  isEthereumAddress,
  closeDbPool
};