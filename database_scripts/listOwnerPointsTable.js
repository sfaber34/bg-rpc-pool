const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function listPointsTable() {
  console.log("Listing owner_points table...");

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
      const result = await client.query('SELECT owner, points::bigint FROM owner_points ORDER BY points DESC');
      console.log("owner_points table contents:");
      console.table(result.rows.map(row => ({
        owner: row.owner,
        points: BigInt(row.points) // Ensure it's treated as a BigInt in JavaScript
      })));
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error listing owner_points table:', err);
    if (err.message?.includes('credential')) {
      console.error('AWS credential error. Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file');
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

listPointsTable();