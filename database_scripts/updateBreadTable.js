const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

async function updateBreadTable(ownerCounts) {
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
      // Update pending bread for each owner
      for (const { owner, count } of ownerCounts) {
        await client.query(`
          INSERT INTO bread (address, pending_bread)
          VALUES ($1, $2)
          ON CONFLICT (address)
          DO UPDATE SET pending_bread = bread.pending_bread + $2
        `, [owner, count]);
      }
      
      console.log(`Updated bread table for ${ownerCounts.length} owners`);
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error updating bread table:', error);
  }
}

module.exports = { updateBreadTable }; 