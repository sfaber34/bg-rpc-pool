const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const axios = require('axios');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function updateLocationTable(enode) {
  let pool;
  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      console.error('Required environment variables are missing. Please check your .env file.');
      console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
      return;
    }

    // Extract IP from enode string
    const ipMatch = enode.match(/@([^:]+):/);
    if (!ipMatch) {
      console.error('Could not extract IP from enode:', enode);
      return;
    }
    const ip = ipMatch[1];

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

    pool = new Pool({
      user: secret.username,
      host: process.env.DB_HOST,
      database: secret.dbname,
      password: secret.password,
      port: secret.port,
    });

    // Check if IP already exists in the table
    const existingRecord = await pool.query('SELECT ip FROM location WHERE ip = $1', [ip]);
    
    if (existingRecord.rows.length === 0) {
      // IP doesn't exist, fetch continent data
      const apiResponse = await axios.get(`https://pro.ip-api.com/json/${ip}?fields=continent&key=xCoYoyXtdmYbpvJ`);
      const { continent } = apiResponse.data;
      
      // Insert new record
      await pool.query('INSERT INTO location (ip, continent) VALUES ($1, $2)', [ip, continent]);
      console.log(`Added new location record - IP: ${ip}, Continent: ${continent}`);
    } else {
      console.log(`IP ${ip} already exists in location table`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error in updateLocationTable:', error);
    if (pool) {
      await pool.end();
    }
  }
}

module.exports = { updateLocationTable };
