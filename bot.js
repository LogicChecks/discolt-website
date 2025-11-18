require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const { startServer, createToken } = require('./server');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

global.discordClient = client;

client.on('ready', () => {
    console.log('Bot logged in as', client.user.tag);
});

client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;

    console.log('New member:', member.user.tag, '(' + member.id + ')');

    try {
        const token = uuidv4();
        createToken(member.id, member.guild.id, token);

        const verifyURL = `${process.env.WEBSITE_URL}/verify?token=${token}`;

        const embed = new EmbedBuilder()
            .setTitle('Verification Required')
            .setDescription(`Welcome to **${member.guild.name}**!\n\nPlease verify your account by clicking the link below:`)
            .setColor(0x5865f2)
            .addFields({
                name: 'Verification Link',
                value: `[Click here to verify](${verifyURL})`
            })
            .setFooter({ text: 'This link expires in 10 minutes' })
            .setTimestamp();

        await member.send({ embeds: [embed] });
        console.log('Sent verification link to', member.user.tag);

        if (process.env.UNVERIFIED_ROLE_ID) {
            await member.roles.add(process.env.UNVERIFIED_ROLE_ID);
        }

    } catch (error) {
        console.error('Error sending verification to', member.user.tag, ':', error);
    }
});

// Start everything
client.login(process.env.DISCORD_TOKEN);
startServer();