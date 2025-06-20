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
let agentState = null;
let messageQueue = [];
let isWaitingForAgent = false;

console.log('🤖 OpenHands WhatsApp Bot - Simple Version');
console.log('==========================================');

// Check session status
const fs = require('fs');
const sessionPath = './whatsapp-session';
if (fs.existsSync(sessionPath)) {
    console.log('📱 Found existing WhatsApp session - will attempt to restore');
    console.log('⚠️  If the bot hangs, the session may be invalid and will be cleared automatically');
} else {
    console.log('📱 No existing session found - QR code will be displayed');
}

// Initialize WhatsApp client with persistent session
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "openhands-simple-bot",
        dataPath: "./whatsapp-session" // Persistent session directory
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
    console.log('🔄 Session may be invalid. Clearing session...');

    // Clear the invalid session
    const fs = require('fs');
    const sessionPath = './whatsapp-session';
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log('🗑️ Cleared invalid session. Please restart the bot to scan QR again.');
    }
    process.exit(1);
});

client.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp disconnected:', reason);
    if (reason === 'LOGOUT') {
        console.log('🔄 Logged out from WhatsApp. Clearing session...');
        const fs = require('fs');
        const sessionPath = './whatsapp-session';
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('🗑️ Session cleared. Please restart the bot to scan QR again.');
        }
    }
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
    isReady = true;
    clearTimeout(initializationTimeout);

    console.log('✅ WhatsApp connected successfully!');
    console.log('💾 Session has been saved - no QR scan needed next time!');
    whatsappClient = client;

    // Initialize OpenHands
    await initializeOpenHands();

    // Wait for agent to be ready
    await waitForAgentReady();

    console.log('\n🎉 Bot is ready! Send a WhatsApp message to chat with OpenHands agent.');
    console.log('📝 Example: "Create a Python script that prints Hello World"');
    console.log('🔄 To restart the bot later, just run: npm run whatsapp-simple');
});

// WhatsApp message event
client.on('message', async (message) => {
    if (message.fromMe) return; // Ignore messages sent by the bot

    const contact = await message.getContact();
    const chat = await message.getChat();
    const userName = contact.pushname || contact.number;

    console.log(`\n📨 Message from ${userName}: "${message.body}"`);

    // Set current chat for responses
    currentWhatsAppChat = chat;

    // Add message to queue
    messageQueue.push({
        text: message.body,
        chat: chat,
        userName: userName,
        timestamp: Date.now()
    });

    console.log(`📝 Message queued. Queue length: ${messageQueue.length}`);
    console.log(`🔄 Agent state: ${agentState || 'unknown'}`);

    // Notify user if agent is busy
    if (agentState !== 'awaiting_user_input' || isWaitingForAgent) {
        await chat.sendMessage('🤖 I received your message! I\'m currently processing another request. Your message is queued and will be processed when I\'m ready.');
    }

    // Process queue if agent is ready
    await processMessageQueue();
});

// OpenHands initialization
async function initializeOpenHands() {
    try {
        console.log('🚀 Connecting to OpenHands...');

        // Create conversation (no settings needed)
        const response = await axios.post(`${OPENHANDS_BASE_URL}/api/conversations`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'X-Session-API-Key': SESSION_API_KEY
            }
        });

        currentConversationId = response.data.conversation_id;
        console.log(`✅ Conversation created: ${currentConversationId}`);

        // Connect WebSocket
        await connectWebSocket();

    } catch (error) {
        console.error('❌ OpenHands initialization failed:', error.message);
        throw error;
    }
}

// WebSocket connection
async function connectWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to WebSocket...');

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
            reconnection: true,
            timeout: 20000
        });

        openhandsSocket.on('connect', () => {
            console.log('✅ WebSocket connected');
            resolve();
        });

        openhandsSocket.on('oh_event', handleAgentEvent);

        openhandsSocket.on('connect_error', (error) => {
            console.error('❌ WebSocket connect_error:', error);
            reject(error);
        });

        openhandsSocket.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            reject(error);
        });

        openhandsSocket.on('disconnect', (reason) => {
            console.log('🔌 WebSocket disconnected:', reason);
        });

        // Handle authentication errors
        openhandsSocket.on('auth_error', (error) => {
            console.error('❌ WebSocket auth error:', error);
            reject(new Error(`Authentication failed: ${error}`));
        });

        setTimeout(() => {
            if (!openhandsSocket.connected) {
                reject(new Error('WebSocket connection timeout after 20 seconds'));
            }
        }, 20000);
    });
}

// Handle agent events
async function handleAgentEvent(event) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 📨 Agent Event: ${event.source} - ${event.action || event.observation || 'status'}`);

    // Track agent state
    if (event.observation === 'agent_state_changed') {
        const newState = event.extras?.agent_state;
        const oldState = agentState;
        agentState = newState;

        console.log(`🔄 Agent state changed: ${oldState} → ${newState}`);

        if (newState === 'loading' || newState === 'running' || newState === 'thinking') {
            isAgentProcessing = true;
            isWaitingForAgent = true;
        } else if (newState === 'awaiting_user_input') {
            isAgentProcessing = false;
            isWaitingForAgent = false;
            console.log('✅ Agent is ready for input!');

            // Process queued messages when agent becomes ready
            await processMessageQueue();
        } else if (newState === 'finished' || newState === 'stopped') {
            isAgentProcessing = false;
            isWaitingForAgent = false;
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

    // Handle file creation/editing
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

// Wait for agent to reach awaiting_user_input state
async function waitForAgentReady() {
    return new Promise((resolve) => {
        console.log('⏳ Waiting for agent to be ready...');

        // Check if already ready
        if (agentState === 'awaiting_user_input' || agentState === 'finished' ) {
            console.log('✅ Agent is already ready!');
            resolve();
            return;
        }

        // Set up a listener for state changes
        const checkState = () => {
            if (agentState === 'awaiting_user_input') {
                console.log('✅ Agent is now ready for input!');
                resolve();
            } else {
                // Check again in 500ms
                setTimeout(checkState, 500);
            }
        };

        checkState();
    });
}

// Process message queue when agent is ready
async function processMessageQueue() {
    // Only process if agent is ready and not already processing
    if ( (agentState !== 'awaiting_user_input' && agentState !== 'finished') || isWaitingForAgent || messageQueue.length === 0) {
        if (messageQueue.length > 0) {
            console.log(`⏳ Waiting for agent to be ready. Current state: ${agentState}, Queue: ${messageQueue.length} messages`);
        }
        return;
    }

    // Get the next message from queue
    const queuedMessage = messageQueue.shift();
    if (!queuedMessage) return;

    console.log(`🚀 Processing message from queue: "${queuedMessage.text}"`);
    console.log(`📝 Remaining in queue: ${messageQueue.length}`);

    // Set current chat
    currentWhatsAppChat = queuedMessage.chat;

    // Send typing indicator
    try {
        await queuedMessage.chat.sendStateTyping();
    } catch (error) {
        console.log('⚠️ Could not send typing indicator:', error.message);
    }

    // Mark as waiting for agent response
    isWaitingForAgent = true;

    // Send to OpenHands agent
    await sendMessageToAgent(queuedMessage.text);
}

// Send message to OpenHands agent
async function sendMessageToAgent(message) {
    try {
        console.log(`📤 Sending to agent: "${message}"`);
        isAgentProcessing = true;

        openhandsSocket.emit('oh_user_action', {
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
        }, 60000); // 1 minute timeout

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

// Add initialization timeout
let initializationTimeout;
let isReady = false;

// Set a timeout for initialization
initializationTimeout = setTimeout(() => {
    if (!isReady) {
        console.log('\n⏰ Initialization timeout after 60 seconds');
        console.log('🔄 This usually means the saved session is invalid or expired');
        console.log('🗑️ Clearing session and restarting...');

        const fs = require('fs');
        const sessionPath = './whatsapp-session';
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('✅ Session cleared. Please restart the bot to scan QR again.');
        }
        process.exit(1);
    }
}, 60000); // 60 second timeout

// Start the bot
console.log('🚀 Starting WhatsApp client...');
console.log('⏳ If this hangs for more than 60 seconds, the session will be reset automatically...');
client.initialize();
