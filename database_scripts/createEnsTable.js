const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const readline = require('readline');
const fs = require('fs');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

async function confirmAction() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('This will create or reset the ENS table. Are you sure? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function createEnsTable() {
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
      // Create the ens table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS ens_table (
          ens_name VARCHAR(255) PRIMARY KEY,
          resolved_address VARCHAR(42) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index on resolved_address for reverse lookups if needed
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ens_table_resolved_address 
        ON ens_table(resolved_address)
      `);

      console.log('ENS table created successfully with the following structure:');
      console.log('- ens_name (VARCHAR(255), PRIMARY KEY): The ENS name');
      console.log('- resolved_address (VARCHAR(42), NOT NULL): The resolved Ethereum address');
      console.log('- created_at (TIMESTAMP): When the record was first created');
      console.log('- updated_at (TIMESTAMP): When the record was last updated');
      console.log('- Index on resolved_address for reverse lookups');
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error creating ENS table:', error);
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  (async () => {
    const confirmed = await confirmAction();
    if (confirmed) {
      await createEnsTable();
    } else {
      console.log('Operation cancelled.');
    }
  })();
}

module.exports = { createEnsTable };