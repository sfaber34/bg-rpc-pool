const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Path to the RDS CA bundle
const RDS_CA_BUNDLE_PATH = '/home/ubuntu/shared/rds-ca-bundle.pem';

// Parse command line arguments
const args = process.argv.slice(2);
let owner = null;
let pointsToAdd = null;

for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '-o') {
    owner = args[i + 1];
  } else if (args[i] === '-a') {
    pointsToAdd = parseInt(args[i + 1]);
  }
}

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function getOwnerPoints(owner) {
  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      console.error('Required environment variables are missing. Please check your .env file.');
      console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
      return 0;
    }

    // Check if RDS CA bundle exists
    if (!fs.existsSync(RDS_CA_BUNDLE_PATH)) {
      console.error('RDS CA bundle not found at:', RDS_CA_BUNDLE_PATH);
      console.error('Please download the bundle from: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem');
      return 0;
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
      const result = await client.query(
        'SELECT points FROM owner_points WHERE owner = $1',
        [owner]
      );
      
      // If no record found, return 0
      if (result.rows.length === 0) {
        return 0;
      }
      
      return result.rows[0].points;
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error getting owner points:', error);
    return 0;
  }
}

async function addOwnerPoints(owner, pointsToAdd) {
  try {
    if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
      console.error('Required environment variables are missing. Please check your .env file.');
      console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
      return false;
    }

    // Check if RDS CA bundle exists
    if (!fs.existsSync(RDS_CA_BUNDLE_PATH)) {
      console.error('RDS CA bundle not found at:', RDS_CA_BUNDLE_PATH);
      console.error('Please download the bundle from: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem');
      return false;
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
      // Check if owner exists
      const checkResult = await client.query(
        'SELECT points FROM owner_points WHERE owner = $1',
        [owner]
      );
      
      const exists = checkResult.rows.length > 0;
      const currentPoints = exists ? parseInt(checkResult.rows[0].points) : 0;
      const newPoints = exists ? currentPoints + pointsToAdd : pointsToAdd;

      console.log('\nCurrent status:');
      console.log(`Owner: ${owner}`);
      console.log(`Current points: ${currentPoints}`);
      console.log(`Points to add: ${pointsToAdd}`);
      console.log(`New total points will be: ${newPoints}`);

      return new Promise((resolve) => {
        rl.question('\nDo you want to proceed with this change? (yes/no): ', async (answer) => {
          if (answer.toLowerCase() === 'yes') {
            if (exists) {
              await client.query(
                'UPDATE owner_points SET points = points + $1 WHERE owner = $2',
                [pointsToAdd, owner]
              );
              console.log(`Successfully updated points for ${owner}`);
            } else {
              await client.query(
                'INSERT INTO owner_points (owner, points) VALUES ($1, $2)',
                [owner, pointsToAdd]
              );
              console.log(`Successfully added new owner ${owner} with ${pointsToAdd} points`);
            }
            resolve(true);
          } else {
            console.log('Operation cancelled by user');
            resolve(false);
          }
          rl.close();
          await pool.end();
        });
      });
    } catch (error) {
      console.error('Error updating owner points:', error);
      await pool.end();
      return false;
    }
  } catch (error) {
    console.error('Error in database operation:', error);
    return false;
  }
}

// Main execution
if (require.main === module) {
  if (!owner || !pointsToAdd) {
    console.error('Usage: node manualAddOwnerPoints.js -o <owner> -a <points>');
    process.exit(1);
  }

  addOwnerPoints(owner, pointsToAdd).then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { getOwnerPoints, addOwnerPoints };
