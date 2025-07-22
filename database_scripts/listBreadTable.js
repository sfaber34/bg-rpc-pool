const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function listBreadTable() {
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

    // Query to select all records from the bread table
    const result = await pool.query('SELECT address, pending_bread FROM bread ORDER BY address');
    
    console.log('\nBread Table Contents:');
    console.log('------------------------');
    
    if (result.rows.length === 0) {
      console.log('No records found in the bread table.');
    } else {
      // Print column headers
      console.log('Address\t\t\tPending Bread');
      console.log('------------------------');
      
      // Print each row
      result.rows.forEach(row => {
        console.log(`${row.address}\t\t${row.pending_bread}`);
      });
      
      // Calculate and print total pending bread
      const totalPendingBread = result.rows.reduce((sum, row) => sum + Number(row.pending_bread), 0);
      console.log(`\nTotal records: ${result.rows.length}`);
      console.log(`Total pending bread: ${totalPendingBread}`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Execute the function
listBreadTable();
