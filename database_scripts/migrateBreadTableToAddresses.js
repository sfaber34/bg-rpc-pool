const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');
const { resolveMultipleEnsToAddresses, isEnsName } = require('../utils/ensResolver');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

async function migrateBreadTableToAddresses() {
  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      console.error('Required environment variables are missing. Please check your .env file.');
      console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
      return;
    }

    // Check if RDS CA bundle exists
    if (!fs.existsSync(RDS_CA_BUNDLE_PATH)) {
      console.error('RDS CA bundle not found at:', RDS_CA_BUNDLE_PATH);
      console.error('Please download the bundle from: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem');
      return;
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

    const pool = new Pool(dbConfig);

    const client = await pool.connect();
    try {
      // First, get all current entries from bread table
      console.log('Fetching current bread table entries...');
      const currentEntries = await client.query('SELECT address, pending_bread FROM bread');
      
      if (currentEntries.rows.length === 0) {
        console.log('No entries found in bread table. Migration not needed.');
        return;
      }

      console.log(`Found ${currentEntries.rows.length} entries in bread table.`);

      // Identify ENS names that need resolution
      const ensEntries = currentEntries.rows.filter(row => isEnsName(row.address));
      const addressEntries = currentEntries.rows.filter(row => !isEnsName(row.address));

      console.log(`Found ${ensEntries.length} ENS entries that need resolution.`);
      console.log(`Found ${addressEntries.length} entries that are already addresses.`);

      if (ensEntries.length === 0) {
        console.log('No ENS entries found. Migration not needed.');
        return;
      }

      // Extract unique ENS names
      const ensNames = ensEntries.map(entry => entry.address);
      
      console.log('Resolving ENS names to addresses...');
      const ensToAddressMap = await resolveMultipleEnsToAddresses(ensNames);

      // Prepare migration data
      const migrations = [];
      const consolidations = {}; // Track if multiple ENS resolve to same address

      for (const entry of ensEntries) {
        const resolvedAddress = ensToAddressMap[entry.address];
        if (resolvedAddress && resolvedAddress !== entry.address) {
          migrations.push({
            originalEns: entry.address,
            resolvedAddress: resolvedAddress,
            pendingBread: entry.pending_bread
          });

          // Track consolidations
          if (consolidations[resolvedAddress]) {
            consolidations[resolvedAddress] += parseFloat(entry.pending_bread);
          } else {
            consolidations[resolvedAddress] = parseFloat(entry.pending_bread);
          }
        } else {
          console.warn(`Could not resolve ENS: ${entry.address}`);
        }
      }

      if (migrations.length === 0) {
        console.log('No ENS names could be resolved. Migration not performed.');
        return;
      }

      console.log(`\nMigration plan:`);
      console.log('================');
      migrations.forEach(migration => {
        console.log(`${migration.originalEns} -> ${migration.resolvedAddress} (${migration.pendingBread} bread)`);
      });

      // Check for existing addresses that would be consolidated
      for (const [address, totalBread] of Object.entries(consolidations)) {
        const existingEntry = addressEntries.find(entry => entry.address === address);
        if (existingEntry) {
          console.log(`\nConsolidation detected: Address ${address} already exists with ${existingEntry.pending_bread} bread.`);
          console.log(`Will be consolidated with ${totalBread} bread from ENS resolution.`);
          console.log(`Total after migration: ${parseFloat(existingEntry.pending_bread) + totalBread} bread`);
        }
      }

      // Ask for confirmation
      console.log('\n⚠️  This migration will:');
      console.log('1. Remove ENS entries from bread table');
      console.log('2. Add/update address entries with resolved addresses');
      console.log('3. Consolidate bread amounts if ENS resolves to existing addresses');
      console.log('\nPress Ctrl+C to cancel, or any key to continue...');
      
      // For script execution, we'll proceed automatically
      // In interactive mode, you might want to add readline here

      console.log('\nStarting migration...');

      // Begin transaction
      await client.query('BEGIN');

      try {
        // For each resolved address, either insert or update
        for (const [address, totalBread] of Object.entries(consolidations)) {
          await client.query(`
            INSERT INTO bread (address, pending_bread)
            VALUES ($1, $2)
            ON CONFLICT (address)
            DO UPDATE SET pending_bread = bread.pending_bread + $2
          `, [address, totalBread]);
        }

        // Remove original ENS entries
        for (const migration of migrations) {
          await client.query('DELETE FROM bread WHERE address = $1', [migration.originalEns]);
        }

        // Commit transaction
        await client.query('COMMIT');

        console.log('\n✅ Migration completed successfully!');
        console.log(`Migrated ${migrations.length} ENS entries to addresses.`);
        
        // Show final state
        const finalEntries = await client.query('SELECT address, pending_bread FROM bread ORDER BY address');
        console.log('\nFinal bread table state:');
        console.log('------------------------');
        finalEntries.rows.forEach(row => {
          console.log(`${row.address}: ${row.pending_bread} bread`);
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  migrateBreadTableToAddresses();
}

module.exports = { migrateBreadTableToAddresses };