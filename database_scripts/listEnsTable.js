const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

async function listEnsTable() {
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
      // Query to select all records from the ens table
      const result = await client.query('SELECT ens_name, resolved_address, created_at, updated_at FROM ens_table ORDER BY ens_name');
      
      console.log('\nENS Table Contents:');
      console.log('------------------------');
      
      if (result.rows.length === 0) {
        console.log('No records found in the ENS table.');
      } else {
        // Print column headers
        console.log('ENS Name\t\t\tResolved Address\t\t\tCreated At\t\tUpdated At');
        console.log('----------------------------------------------------------------------------------------');
        
        // Print each row
        result.rows.forEach(row => {
          const createdAt = new Date(row.created_at).toISOString().slice(0, 19).replace('T', ' ');
          const updatedAt = new Date(row.updated_at).toISOString().slice(0, 19).replace('T', ' ');
          console.log(`${row.ens_name.padEnd(25)}\t${row.resolved_address}\t${createdAt}\t${updatedAt}`);
        });
        
        console.log(`\nTotal records: ${result.rows.length}`);
      }
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error listing ENS table:', error);
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  listEnsTable();
}

module.exports = { listEnsTable };