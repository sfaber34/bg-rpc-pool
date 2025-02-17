const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function listLocationTable() {
  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      console.error('Required environment variables are missing. Please check your .env file.');
      console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
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

    const pool = new Pool({
      user: secret.username,
      host: process.env.DB_HOST,
      database: secret.dbname,
      password: secret.password,
      port: secret.port,
    });

    // Query to select all records from the location table
    const result = await pool.query('SELECT ip, continent FROM location');
    
    console.log('\nLocation Table Contents:');
    console.log('------------------------');
    
    if (result.rows.length === 0) {
      console.log('No records found in the location table.');
    } else {
      // Print column headers
      console.log('IP Address\tContinent');
      console.log('------------------------');
      
      // Print each row
      result.rows.forEach(row => {
        console.log(`${row.ip}\t${row.continent}`);
      });
      
      console.log(`\nTotal records: ${result.rows.length}`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Execute the function
listLocationTable();
