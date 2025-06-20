const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { io } = require('socket.io-client');
const axios = require('axios');

// Configuration
const OPENHANDS_BASE_URL = 'http://localhost:3000';
const SESSION_API_KEY = '175856fd-7dfa-4f67-88e8-1dbf076a8f99';

// Global variables
let openhandsSocket = null;
let currentConversationId = null;
let whatsappClient = null;
let agentResponses = new Map(); // Store agent responses by message ID
let pendingMessages = new Map(); // Track pending messages waiting for agent response

console.log('🤖 Starting OpenHands WhatsApp Bot...');

// Initialize WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "openhands-bot",
        dataPath: "./whatsapp-session-full" // Persistent session directory
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        timeout: 60000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
    }
});

// WhatsApp authentication events
client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading WhatsApp: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
    console.log('✅ WhatsApp session authenticated! (Using saved session)');
});

client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp authentication failed:', msg);
    console.log('🔄 You may need to scan the QR code again...');
});

client.on('qr', (qr) => {
    console.log('\n📱 FIRST TIME SETUP - SCAN THIS QR CODE:');
    console.log('==========================================');
    console.log('⚠️  You only need to scan this ONCE!');
    console.log('⚠️  After scanning, the session will be saved for future use.');
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('\n📋 Instructions:');
    console.log('1. Open WhatsApp on your phone');
    console.log('2. Go to Settings > Linked Devices');
    console.log('3. Tap "Link a Device"');
    console.log('4. Scan the QR code above');
    console.log('5. Session will be saved automatically!');
    console.log('6. Next time you run the bot, no QR scan needed! 🎉\n');
});

// Pairing code only needs to be requested once
// let pairingCodeRequested = false;
// client.on('qr', async (qr) => {
//     // NOTE: This event will not be fired if a session is specified.
//     console.log('QR RECEIVED', qr);

//     // paiuting code example
//     const pairingCodeEnabled = false;
//     if (pairingCodeEnabled && !pairingCodeRequested) {
//         const pairingCode = await client.requestPairingCode('601159954910'); // enter the target phone number
//         console.log('Pairing code enabled, code: '+ pairingCode);
//         pairingCodeRequested = true;
//     }
// });

client.on('ready', async () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('💾 Session has been saved - no QR scan needed next time!');
    whatsappClient = client;

    // Initialize OpenHands connection
    await initializeOpenHands();

    console.log('🎉 Bot is fully operational! Send messages to your WhatsApp to chat with OpenHands agent.');
    console.log('🔄 To restart the bot later, just run: npm run whatsapp');
});

client.on('message', async (message) => {
    // Only respond to messages sent to the bot (not from the bot)
    if (message.fromMe) return;

    const contact = await message.getContact();
    const chatName = contact.pushname || contact.number;

    console.log(`\n📨 Received WhatsApp message from ${chatName}:`);
    console.log(`💬 "${message.body}"`);

    // Send typing indicator
    const chat = await message.getChat();
    await chat.sendStateTyping();

    // Send message to OpenHands agent
    await sendToOpenHandsAgent(message.body, message.id.id, chat);
});

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp client disconnected:', reason);
});

// OpenHands functions
async function initializeOpenHands() {
    try {
        console.log('🚀 Initializing OpenHands connection...');

        // Create conversation
        const conversationResponse = await axios.post(`${OPENHANDS_BASE_URL}/api/conversations`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'X-Session-API-Key': SESSION_API_KEY
            }
        });

        currentConversationId = conversationResponse.data.conversation_id;
        console.log(`✅ OpenHands conversation created: ${currentConversationId}`);

        // Connect to WebSocket
        await connectToOpenHandsWebSocket();

    } catch (error) {
        console.error('❌ Failed to initialize OpenHands:', error.message);
        throw error;
    }
}

async function connectToOpenHandsWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to OpenHands WebSocket...');

        const socketUrl = `${OPENHANDS_BASE_URL}`;
        const socketOptions = {
            query: {
                conversation_id: currentConversationId,
                latest_event_id: -1,
                providers_set: '',
                session_api_key: SESSION_API_KEY
            },
            transports: ['websocket'],
            upgrade: false
        };

        openhandsSocket = io(socketUrl, socketOptions);

        openhandsSocket.on('connect', () => {
            console.log('✅ Connected to OpenHands WebSocket');
            resolve();
        });

        openhandsSocket.on('disconnect', (reason) => {
            console.log('🔌 OpenHands WebSocket disconnected:', reason);
        });

        openhandsSocket.on('connect_error', (error) => {
            console.error('❌ OpenHands WebSocket connection error:', error.message);
            reject(error);
        });

        // Handle agent events
        openhandsSocket.on('event', (data) => {
            handleOpenHandsEvent(data);
        });

        // Set connection timeout
        setTimeout(() => {
            if (!openhandsSocket.connected) {
                reject(new Error('WebSocket connection timeout'));
            }
        }, 10000);
    });
}

function handleOpenHandsEvent(event) {
    console.log(`📨 OpenHands Event: ${event.source} - ${event.action || event.observation || 'unknown'}`);

    // Handle agent responses
    if (event.source === 'agent' && (event.action === 'message' || event.observation === 'message')) {
        const agentMessage = event.message || event.content || 'Agent response received';
        console.log(`🤖 Agent response: ${agentMessage}`);

        // Send agent response to all pending WhatsApp chats
        sendAgentResponseToWhatsApp(agentMessage);
    }

    // Handle agent state changes
    if (event.observation === 'agent_state_changed') {
        const state = event.extras?.agent_state || 'unknown';
        console.log(`🔄 Agent state: ${state}`);

        if (state === 'finished' || state === 'stopped') {
            // Agent finished processing, check for any final responses
            setTimeout(() => {
                checkForPendingResponses();
            }, 2000);
        }
    }

    // Handle action results that might contain useful information
    if (event.source === 'agent' && event.action) {
        if (event.action === 'run' || event.action === 'edit' || event.action === 'create') {
            const actionInfo = `Agent performed: ${event.action}`;
            if (event.args && event.args.command) {
                console.log(`🔧 Agent command: ${event.args.command}`);
            }
        }
    }

    // Handle observations that might contain results
    if (event.source === 'environment' && event.observation === 'run') {
        if (event.content && event.content.trim()) {
            const output = event.content.trim();
            console.log(`📋 Command output: ${output}`);

            // If there are pending messages, send this output as response
            if (pendingMessages.size > 0) {
                sendAgentResponseToWhatsApp(`Command output:\n${output}`);
            }
        }
    }
}

async function sendToOpenHandsAgent(message, messageId, whatsappChat) {
    try {
        console.log(`📤 Sending to OpenHands agent: "${message}"`);

        // Store the WhatsApp chat for this message
        pendingMessages.set(messageId, {
            chat: whatsappChat,
            originalMessage: message,
            timestamp: Date.now()
        });

        // Send message to agent via WebSocket
        openhandsSocket.emit('oh_user_action', {
            action: 'message',
            args: {
                content: message,
                image_urls: null,
                wait_for_response: true
            },
            source: 'user',
            timestamp: new Date().toISOString()
        });

        console.log('✅ Message sent to OpenHands agent');

        // Set a timeout to handle cases where agent doesn't respond
        setTimeout(() => {
            if (pendingMessages.has(messageId)) {
                console.log('⏰ Agent response timeout, sending default message');
                sendAgentResponseToWhatsApp('I received your message and I\'m processing it. Please wait for my response.');
                pendingMessages.delete(messageId);
            }
        }, 30000); // 30 second timeout

    } catch (error) {
        console.error('❌ Failed to send message to OpenHands agent:', error.message);
        await whatsappChat.sendMessage('Sorry, I encountered an error while processing your message. Please try again.');
    }
}

async function sendAgentResponseToWhatsApp(agentMessage) {
    try {
        // Send response to all pending WhatsApp chats
        for (const [messageId, pendingData] of pendingMessages.entries()) {
            const { chat } = pendingData;

            console.log(`📱 Sending agent response to WhatsApp: "${agentMessage}"`);
            await chat.sendMessage(agentMessage);

            // Remove from pending messages
            pendingMessages.delete(messageId);
        }

        // If no pending messages, this might be an unsolicited agent message
        if (pendingMessages.size === 0) {
            console.log('ℹ️ Agent sent message but no pending WhatsApp conversations');
        }

    } catch (error) {
        console.error('❌ Failed to send message to WhatsApp:', error.message);
    }
}

async function checkForPendingResponses() {
    // Check if there are any pending messages that haven't received responses
    for (const [messageId, pendingData] of pendingMessages.entries()) {
        const { chat, timestamp } = pendingData;
        const elapsed = Date.now() - timestamp;

        if (elapsed > 60000) { // 1 minute timeout
            console.log('⏰ Sending timeout response for pending message');
            await chat.sendMessage('I\'m still processing your request. It might take a bit longer than expected.');
            pendingMessages.delete(messageId);
        }
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down WhatsApp bot...');

    if (openhandsSocket) {
        openhandsSocket.disconnect();
        console.log('🔌 OpenHands WebSocket disconnected');
    }

    if (whatsappClient) {
        await whatsappClient.destroy();
        console.log('📱 WhatsApp client disconnected');
    }

    console.log('👋 Bot shutdown complete');
    process.exit(0);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Start the bot
console.log('🚀 Initializing WhatsApp client...');
client.initialize();
