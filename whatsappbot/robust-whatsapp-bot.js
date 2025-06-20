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
let currentWhatsAppChat = null;
let isAgentProcessing = false;
let connectionRetries = 0;
const MAX_RETRIES = 3;

console.log('🤖 Robust OpenHands WhatsApp Bot');
console.log('=================================');

// Initialize WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "openhands-robust-bot",
        dataPath: "./whatsapp-session-robust" // Separate session for robust bot
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
    console.log('\n📋 Steps:');
    console.log('1. Open WhatsApp on your phone');
    console.log('2. Go to Settings > Linked Devices');
    console.log('3. Tap "Link a Device"');
    console.log('4. Scan the QR code above');
    console.log('5. Session will be saved automatically!');
    console.log('6. Next time you run the bot, no QR scan needed! 🎉\n');
});

// WhatsApp ready event
client.on('ready', async () => {
    console.log('✅ WhatsApp connected successfully!');
    console.log('💾 Session has been saved - no QR scan needed next time!');
    whatsappClient = client;

    // Initialize OpenHands with retry logic
    await initializeOpenHandsWithRetry();

    console.log('\n🎉 Bot is ready! Send a WhatsApp message to chat with OpenHands agent.');
    console.log('📝 Example: "Create a Python script that prints Hello World"');
    console.log('🔄 To restart the bot later, just run: npm run whatsapp-robust');
});

// WhatsApp message event
client.on('message', async (message) => {
    if (message.fromMe) return;

    const contact = await message.getContact();
    const chat = await message.getChat();
    const userName = contact.pushname || contact.number;

    console.log(`\n📨 Message from ${userName}: "${message.body}"`);

    // Check if agent is busy
    if (isAgentProcessing) {
        await chat.sendMessage('🤖 I\'m currently processing another request. Please wait...');
        return;
    }

    // Set current chat for responses
    currentWhatsAppChat = chat;

    // Send typing indicator
    await chat.sendStateTyping();

    // Check OpenHands connection
    if (!openhandsSocket || !openhandsSocket.connected) {
        await chat.sendMessage('🔄 Reconnecting to OpenHands...');
        try {
            await initializeOpenHandsWithRetry();
            await chat.sendMessage('✅ Reconnected! Processing your message...');
        } catch (error) {
            await chat.sendMessage('❌ Failed to connect to OpenHands. Please try again later.');
            return;
        }
    }

    // Send to OpenHands agent
    await sendMessageToAgent(message.body);
});

// OpenHands initialization with retry logic
async function initializeOpenHandsWithRetry() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`🚀 Connecting to OpenHands (attempt ${attempt}/${MAX_RETRIES})...`);
            await initializeOpenHands();
            connectionRetries = 0;
            return;
        } catch (error) {
            console.error(`❌ Attempt ${attempt} failed:`, error.message);
            if (attempt === MAX_RETRIES) {
                throw new Error(`Failed to connect after ${MAX_RETRIES} attempts: ${error.message}`);
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
}

// OpenHands initialization
async function initializeOpenHands() {
    try {
        // Create conversation
        const response = await axios.post(`${OPENHANDS_BASE_URL}/api/conversations`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'X-Session-API-Key': SESSION_API_KEY
            },
            timeout: 10000
        });

        currentConversationId = response.data.conversation_id;
        console.log(`✅ Conversation created: ${currentConversationId}`);

        // Connect WebSocket
        await connectWebSocket();

    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error('OpenHands server is not running on port 3000');
        } else if (error.response?.status === 401) {
            throw new Error('Authentication failed - check SESSION_API_KEY');
        } else {
            throw error;
        }
    }
}

// WebSocket connection with better error handling
async function connectWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to WebSocket...');

        // Clean up existing connection
        if (openhandsSocket) {
            openhandsSocket.removeAllListeners();
            openhandsSocket.disconnect();
        }

        const socketUrl = `${OPENHANDS_BASE_URL}`;
        openhandsSocket = io(socketUrl, {
            query: {
                conversation_id: currentConversationId,
                latest_event_id: -1,
                providers_set: '',
                session_api_key: SESSION_API_KEY
            },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false, // Handle reconnection manually
            timeout: 20000
        });

        let resolved = false;

        openhandsSocket.on('connect', () => {
            console.log('✅ WebSocket connected');
            if (!resolved) {
                resolved = true;
                resolve();
            }
        });

        openhandsSocket.on('event', handleAgentEvent);

        openhandsSocket.on('connect_error', (error) => {
            console.error('❌ WebSocket connect_error:', error);
            if (!resolved) {
                resolved = true;
                reject(new Error(`Connection error: ${error.message || error}`));
            }
        });

        openhandsSocket.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            if (!resolved) {
                resolved = true;
                reject(new Error(`Socket error: ${error.message || error}`));
            }
        });

        openhandsSocket.on('disconnect', (reason) => {
            console.log('🔌 WebSocket disconnected:', reason);
            if (reason === 'io server disconnect') {
                // Server disconnected, try to reconnect
                setTimeout(() => {
                    if (currentConversationId) {
                        console.log('🔄 Attempting to reconnect...');
                        initializeOpenHandsWithRetry().catch(console.error);
                    }
                }, 5000);
            }
        });

        // Timeout handler
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('WebSocket connection timeout after 20 seconds'));
            }
        }, 20000);
    });
}

// Handle agent events
function handleAgentEvent(event) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 📨 Agent Event: ${event.source} - ${event.action || event.observation || 'status'}`);

    // Track agent state
    if (event.observation === 'agent_state_changed') {
        const state = event.extras?.agent_state;
        console.log(`🔄 Agent state: ${state}`);

        if (state === 'loading' || state === 'running' || state === 'thinking') {
            isAgentProcessing = true;
        } else if (state === 'finished' || state === 'stopped') {
            isAgentProcessing = false;
        }
    }

    // Handle agent messages/responses
    if (event.source === 'agent' && event.message) {
        sendToWhatsApp(`🤖 ${event.message}`);
    }

    // Handle command outputs
    if (event.source === 'environment' && event.observation === 'run' && event.content) {
        const output = event.content.trim();
        if (output && currentWhatsAppChat) {
            sendToWhatsApp(`📋 Output:\n\`\`\`\n${output}\n\`\`\``);
        }
    }

    // Handle file operations
    if (event.source === 'agent' && (event.action === 'create' || event.action === 'edit')) {
        const action = event.action;
        const path = event.args?.path || 'file';
        sendToWhatsApp(`📝 ${action === 'create' ? 'Created' : 'Edited'} file: ${path}`);
    }

    // Handle thinking/reasoning
    if (event.source === 'agent' && event.action === 'think' && event.args?.thought) {
        sendToWhatsApp(`💭 Thinking: ${event.args.thought}`);
    }
}

// Send message to OpenHands agent
async function sendMessageToAgent(message) {
    try {
        console.log(`📤 Sending to agent: "${message}"`);
        isAgentProcessing = true;

        if (!openhandsSocket || !openhandsSocket.connected) {
            throw new Error('WebSocket not connected');
        }

        openhandsSocket.emit('action', {
            action: 'message',
            args: {
                content: message,
                wait_for_response: true
            }
        });

        console.log('✅ Message sent to agent');

        // Timeout fallback
        setTimeout(() => {
            if (isAgentProcessing) {
                isAgentProcessing = false;
                sendToWhatsApp('⏰ Request is taking longer than expected. The agent is still working on it.');
            }
        }, 60000);

    } catch (error) {
        console.error('❌ Failed to send message:', error.message);
        isAgentProcessing = false;
        sendToWhatsApp('❌ Sorry, I encountered an error. Please try again.');
    }
}

// Send message to WhatsApp
async function sendToWhatsApp(message) {
    if (!currentWhatsAppChat) {
        console.log('⚠️ No active WhatsApp chat');
        return;
    }

    try {
        console.log(`📱 Sending to WhatsApp: "${message}"`);
        await currentWhatsAppChat.sendMessage(message);
    } catch (error) {
        console.error('❌ Failed to send WhatsApp message:', error.message);
    }
}

// Health check function
async function healthCheck() {
    try {
        const response = await axios.get(`${OPENHANDS_BASE_URL}/api/options/config`, {
            headers: { 'X-Session-API-Key': SESSION_API_KEY },
            timeout: 5000
        });
        return true;
    } catch (error) {
        return false;
    }
}

// Periodic health check
setInterval(async () => {
    const isHealthy = await healthCheck();
    if (!isHealthy && openhandsSocket?.connected) {
        console.log('⚠️ OpenHands server appears to be down, disconnecting WebSocket');
        openhandsSocket.disconnect();
    }
}, 30000); // Check every 30 seconds

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');

    if (openhandsSocket) {
        openhandsSocket.disconnect();
    }

    if (whatsappClient) {
        await whatsappClient.destroy();
    }

    console.log('👋 Goodbye!');
    process.exit(0);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Start the bot
console.log('🚀 Starting WhatsApp client...');
client.initialize();
