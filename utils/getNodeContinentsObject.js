const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const path = require('path');

// Load .env from the project root directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Initialize nodeContinents with all continents set to 0
const nodeContinents = {
    continents: {
        "North America": 0,
        "South America": 0,
        "Europe": 0,
        "Asia": 0,
        "Africa": 0,
        "Australia": 0
    }
};

async function getNodeContinentsObject(poolMap) {
    try {
        await constructNodeContinentsObject(poolMap);
        return nodeContinents;
    } catch (error) {
        console.error('Error in getNodeContinentsObject:', error);
        return nodeContinents; // Return default state if there's an error
    }
}

async function constructNodeContinentsObject(poolMap) {
    let dbPool;
    try {
        if (!poolMap) {
            console.error('poolMap is undefined or null');
            return;
        }

        if (!process.env.RDS_SECRET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.DB_HOST) {
            console.error('Required environment variables are missing. Please check your .env file.');
            console.error('Required: RDS_SECRET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DB_HOST');
            return;
        }

        // Reset all continent counts
        Object.keys(nodeContinents.continents).forEach(continent => {
            nodeContinents.continents[continent] = 0;
        });

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

        dbPool = new Pool({
            user: secret.username,
            host: process.env.DB_HOST,
            database: secret.dbname,
            password: secret.password,
            port: secret.port,
        });

        // Process each node in the poolMap
        for (const [_, nodeData] of poolMap) {
            if (nodeData.enode) {
                try {
                    // Extract IP from enode
                    const enodeUrl = new URL(nodeData.enode.replace('enode://', 'http://'));
                    const ip = enodeUrl.hostname;

                    // Query the database for the continent
                    const query = 'SELECT continent FROM location WHERE ip = $1';
                    const result = await dbPool.query(query, [ip]);

                    if (result.rows.length > 0) {
                        const continent = result.rows[0].continent;
                        // Increment the counter for this continent if it exists in our object
                        if (nodeContinents.continents.hasOwnProperty(continent)) {
                            nodeContinents.continents[continent]++;
                        }
                    }
                } catch (err) {
                    console.error(`Error processing node ${nodeData.enode}:`, err);
                }
            }
        }

        await dbPool.end();
    } catch (err) {
        console.error('Error in constructNodeContinentsObject:', err);
        if (dbPool) {
            await dbPool.end();
        }
    }
}

module.exports = { constructNodeContinentsObject, getNodeContinentsObject };

