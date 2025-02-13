const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function incrementOwnerPoints(owner) {
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

    console.log('Fetching database credentials from AWS Secrets Manager...');
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
        rejectUnauthorized: false
      }
    };

    console.log(`Connecting to database at ${process.env.DB_HOST}...`);
    const pool = new Pool(dbConfig);

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO owner_points (owner, points)
        VALUES ($1, 10)
        ON CONFLICT (owner)
        DO UPDATE SET points = owner_points.points + 10
      `, [owner]);
      console.log(`Successfully incremented points for ${owner}`);
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.error('Error incrementing owner points:', err);
    if (err.message?.includes('credential')) {
      console.error('AWS credential error. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file');
    }
  }
}

module.exports = { incrementOwnerPoints };