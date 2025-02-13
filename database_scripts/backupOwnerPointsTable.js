const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const fs = require('fs');
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function backupOwnerPointsTable() {
  console.log("Backing up owner_points table...");

  if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Required environment variables are missing. Please check your .env file.');
    return;
  }

  const secret_name = process.env.RDS_SECRET_NAME;
  const secretsClient = new SecretsManagerClient({ 
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  let pool;

  try {
    console.log('Fetching database credentials from AWS Secrets Manager...');
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT",
      })
    );
    const secret = JSON.parse(response.SecretString);

    const dbConfig = {
      host: process.env.DB_HOST,
      user: secret.username,
      password: secret.password,
      database: secret.dbname || 'postgres',
      port: 5432,
      ssl: {
        rejectUnauthorized: false
      }
    };

    console.log(`Connecting to database at ${process.env.DB_HOST}...`);
    pool = new Pool(dbConfig);

    const client = await pool.connect();
    try {
      console.log('Querying owner_points table...');
      const result = await client.query('SELECT owner, points::bigint FROM owner_points ORDER BY points DESC');
      
      const timestamp = new Date().toUTCString();
      let newBackupContent = `Owner Points Table Backup - ${timestamp}\n`;
      newBackupContent += "===============================================\n\n";
      newBackupContent += "Owner".padEnd(50) + "Points\n";
      newBackupContent += "=".repeat(60) + "\n";

      result.rows.forEach(row => {
        newBackupContent += `${row.owner.padEnd(50)}${row.points}\n`;
      });

      newBackupContent += "\n\n\n\n";  // Add some space between backups

      // Read existing content (if any)
      let existingContent = '';
      const backupFile = '../ownerPointsTableBackup.txt';
      if (fs.existsSync(backupFile)) {
        console.log(`Reading existing backup from ${backupFile}...`);
        existingContent = fs.readFileSync(backupFile, 'utf8');
      }

      // Combine new content with existing content
      const updatedContent = newBackupContent + existingContent;

      // Write the combined content back to the file
      console.log(`Writing updated backup to ${backupFile}...`);
      fs.writeFileSync(backupFile, updatedContent);

      console.log("Backup successfully appended to ownerPointsTableBackup.txt");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error backing up owner_points table:', err);
    if (err.message?.includes('credential')) {
      console.error('AWS credential error. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file');
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

backupOwnerPointsTable();
