const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

async function resetBreadTable(addressesToReset = null) {
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
      let result;
      
      if (addressesToReset && addressesToReset.length > 0) {
        // Reset only specific addresses
        const placeholders = addressesToReset.map((_, index) => `$${index + 1}`).join(', ');
        const query = `UPDATE bread SET pending_bread = 0 WHERE address IN (${placeholders}) AND pending_bread > 0`;
        result = await client.query(query, addressesToReset);
        
        console.log(`Reset pending bread for ${result.rowCount} specific addresses`);
      } else {
        // Reset all pending bread (original behavior)
        result = await client.query('UPDATE bread SET pending_bread = 0 WHERE pending_bread > 0');
        
        console.log(`Reset pending bread for ${result.rowCount} addresses`);
      }
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error resetting bread table:', error);
  }
}

module.exports = { resetBreadTable }; 