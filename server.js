const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = './data.json';

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ fingerprints: [], tokens: [] }, null, 2));
}

// Read data
function readData() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Write data
function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Clean expired tokens (older than 10 minutes)
function cleanExpiredTokens() {
    const data = readData();
    const now = Date.now();
    data.tokens = data.tokens.filter(t => (now - t.createdAt) < 600000); // 10 min
    writeData(data);
}

// Get real IP
function getIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress;
}

// Verification page
app.get('/verify', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// Submit verification
app.post('/api/verify', async (req, res) => {
    try {
        const { token, fingerprint, components } = req.body;
        const ip = getIP(req);
        const userAgent = req.headers['user-agent'];

        console.log('Verification attempt - Token:', token);

        cleanExpiredTokens();
        const data = readData();

        // 1. Find token
        const tokenData = data.tokens.find(t => t.token === token && !t.used);
        if (!tokenData) {
            return res.json({ 
                success: false, 
                reason: 'Invalid or expired token' 
            });
        }

        const { discordId, guildId } = tokenData;

        // 2. Check for existing fingerprint
        const fingerprintMatch = data.fingerprints.find(f => f.fingerprint === fingerprint);
        if (fingerprintMatch) {
            console.log('ALT DETECTED! Fingerprint match:', fingerprintMatch.discordId);
            
            // Mark token as used
            tokenData.used = true;
            writeData(data);

            // Notify Discord
            if (global.discordClient) {
                await notifyAltDetected(guildId, discordId, fingerprintMatch, 'fingerprint');
            }

            return res.json({ 
                success: false, 
                reason: 'alt_detected',
                matchType: 'fingerprint'
            });
        }

        // 3. Check for same IP
        const ipMatch = data.fingerprints.find(f => f.ip === ip);
        if (ipMatch) {
            console.log('ALT DETECTED! IP match:', ipMatch.discordId);
            
            tokenData.used = true;
            writeData(data);

            if (global.discordClient) {
                await notifyAltDetected(guildId, discordId, ipMatch, 'ip');
            }

            return res.json({ 
                success: false, 
                reason: 'alt_detected',
                matchType: 'ip'
            });
        }

        // 4. Store new fingerprint
        data.fingerprints.push({
            discordId,
            fingerprint,
            ip,
            components,
            userAgent,
            timestamp: new Date().toISOString()
        });

        // Mark token as used
        tokenData.used = true;
        writeData(data);

        // 5. Verify user in Discord
        if (global.discordClient) {
            await verifyDiscordUser(guildId, discordId);
        }

        console.log('User verified:', discordId);
        res.json({ success: true });

    } catch (error) {
        console.error('Error processing verification:', error);
        res.json({ success: false, reason: 'Server error' });
    }
});

// Create verification token
function createToken(discordId, guildId, token) {
    const data = readData();
    data.tokens.push({
        token,
        discordId,
        guildId,
        used: false,
        createdAt: Date.now()
    });
    writeData(data);
}

// Notify mods of alt detection
async function notifyAltDetected(guildId, newUserId, existingUser, matchType) {
    try {
        const guild = await global.discordClient.guilds.fetch(guildId);
        const alertChannel = guild.channels.cache.get(process.env.ALERT_CHANNEL_ID);
        const newUser = await guild.members.fetch(newUserId).catch(() => null);
        
        if (alertChannel) {
            await alertChannel.send({
                embeds: [{
                    title: 'Alt Account Detected',
                    color: 0xff0000,
                    fields: [
                        { 
                            name: 'New Account', 
                            value: newUser ? `${newUser.user.tag} (${newUserId})` : newUserId,
                            inline: true 
                        },
                        { 
                            name: 'Existing Account', 
                            value: `<@${existingUser.discordId}>`,
                            inline: true 
                        },
                        { 
                            name: 'Match Type', 
                            value: matchType.toUpperCase(),
                            inline: true 
                        },
                        {
                            name: 'IP Address',
                            value: `\`${existingUser.ip}\``,
                            inline: false
                        },
                        {
                            name: 'Action Taken',
                            value: 'Verification denied & user kicked'
                        }
                    ],
                    timestamp: new Date()
                }]
            });
        }

        // Kick the user
        if (newUser) {
            await newUser.kick('Alt account detected');
        }

    } catch (error) {
        console.error('Error notifying alt detection:', error);
    }
}

// Verify user in Discord
async function verifyDiscordUser(guildId, userId) {
    try {
        const guild = await global.discordClient.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        
        if (process.env.UNVERIFIED_ROLE_ID) {
            await member.roles.remove(process.env.UNVERIFIED_ROLE_ID);
        }
        
        if (process.env.VERIFIED_ROLE_ID) {
            await member.roles.add(process.env.VERIFIED_ROLE_ID);
        }

        await member.send('You have been verified! Welcome to the server.').catch(() => {});

    } catch (error) {
        console.error('Error verifying Discord user:', error);
    }
}

function startServer() {
    app.listen(process.env.PORT, () => {
        console.log('Web server running on port', process.env.PORT);
        console.log('Using', DATA_FILE, 'for storage');
    });
}

module.exports = { startServer, createToken };