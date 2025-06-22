const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');
const { io } = require('socket.io-client');
const axios = require('axios');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

// Configuration
const OPENHANDS_BASE_URL = 'http://localhost:3000';
const SESSION_API_KEY = '175856fd-7dfa-4f67-88e8-1dbf076a8f99';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsappbot';

// Message filtering configuration
const MESSAGE_FILTER_CONFIG = {
    showThoughts: false,           // Show agent thinking processes
    showCommandOutputs: true,      // Show command execution results
    showFileOperations: true,      // Show file creation/editing notifications
    maxOutputLength: 500,          // Maximum length for command outputs
    showSystemMessages: false,     // Show system/setup messages
    showStateChanges: false        // Show agent state changes
};

// MongoDB Schema
const conversationSchema = new mongoose.Schema({
    phone_number: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    conversation_id: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// Global variables
let openhandsSocket = null;
let currentConversationId = null;
let whatsappClient = null;
let currentWhatsAppChat = null;
let currentUserPhoneNumber = null;
let currentUserName = null;
let isAgentProcessing = false;
let agentState = null;
let messageQueue = [];
let isWaitingForAgent = false;

console.log('🤖 OpenHands WhatsApp Bot - Simple Version');
console.log('==========================================');

// Initialize MongoDB connection
async function initializeMongoDB() {
    try {
        // Set connection timeout and other options
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000, // 10 second timeout
            connectTimeoutMS: 10000,
            socketTimeoutMS: 10000,
        });
        console.log('✅ Connected to MongoDB');

        // Test the connection
        await mongoose.connection.db.admin().ping();
        console.log('✅ MongoDB connection verified');

    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        console.error('💡 Make sure MongoDB is running on:', MONGODB_URI);
        console.error('💡 You can start MongoDB with: mongod --dbpath /path/to/your/db');
        process.exit(1);
    }
}

// Global variables for WhatsApp client and store
let client;
let store;

// Helper function to check if a message should be filtered out
function shouldFilterMessage(message) {
    if (!message || typeof message !== 'string') return true;

    const lowerMessage = message.toLowerCase().trim();

    // Filter out system/setup messages
    const systemPhrases = [
        'you are openhands agent',
        'i am openhands',
        'i\'m an ai assistant',
        'i\'m here to help',
        'how can i help you',
        'what can i do for you',
        'i\'ll help you',
        'let me help',
        'i understand you want',
        'i\'ll start by',
        'let me start',
        'i need to',
        'i should',
        'first, i\'ll',
        'i\'ll begin by'
    ];

    // Check if message contains any system phrases
    for (const phrase of systemPhrases) {
        if (lowerMessage.includes(phrase)) {
            return true;
        }
    }

    // Filter out very short or empty messages
    if (lowerMessage.length < 10) return true;

    // Filter out messages that are just acknowledgments
    const acknowledgments = ['ok', 'sure', 'yes', 'understood', 'got it', 'alright'];
    if (acknowledgments.includes(lowerMessage)) return true;

    return false;
}

// Helper function to clean and format messages for WhatsApp
function formatMessageForWhatsApp(message) {
    if (!message) return '';

    // Clean up the message
    let cleaned = message.trim();

    // Remove excessive newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Remove markdown formatting that doesn't work well in WhatsApp
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '*$1*'); // Bold
    cleaned = cleaned.replace(/__(.*?)__/g, '_$1_'); // Italic

    // Limit message length for WhatsApp
    const maxLength = 1000;
    if (cleaned.length > maxLength) {
        cleaned = cleaned.substring(0, maxLength) + '...\n(Message truncated)';
    }

    return cleaned;
}

// Conversation management function
async function getOrCreateConversation(phoneNumber, senderName) {
    try {
        // Check if conversation already exists for this phone number
        let conversation = await Conversation.findOne({ phone_number: phoneNumber });

        if (conversation) {
            console.log(`📞 Found existing conversation for ${phoneNumber}: ${conversation.conversation_id}`);
            return conversation.conversation_id;
        }

        // Create new conversation if none exists
        console.log(`📞 Creating new conversation for ${phoneNumber} (${senderName})`);

        // Create conversation via OpenHands API
        const response = await axios.post(`${OPENHANDS_BASE_URL}/api/conversations`, {}, {
            headers: {
                'X-API-Key': SESSION_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const conversationId = response.data.conversation_id;
        console.log(`✅ Created new conversation: ${conversationId}`);

        // Save conversation record to MongoDB
        conversation = new Conversation({
            phone_number: phoneNumber,
            name: senderName,
            conversation_id: conversationId
        });

        await conversation.save();
        console.log(`💾 Saved conversation record to MongoDB`);

        return conversationId;

    } catch (error) {
        console.error('❌ Error managing conversation:', error.message);
        throw error;
    }
}

// Async function to initialize everything in the correct order
async function initializeBot() {
    try {
        // Step 1: Initialize MongoDB connection
        console.log('🔄 Initializing MongoDB connection...');
        await initializeMongoDB();

        // Step 2: Create MongoStore after connection is established
        console.log('🔄 Creating MongoStore...');
        store = new MongoStore({ mongoose: mongoose });
        console.log('✅ MongoStore created successfully');

        // Step 3: Initialize WhatsApp client with RemoteAuth
        console.log('📱 Using RemoteAuth with MongoDB session storage');
        console.log('📱 Session will be loaded from MongoDB if available, otherwise QR code will be displayed');

        client = new Client({
    authStrategy: new RemoteAuth({
        // clientId: "openhands-simple-bot",
        // dataPath: "./whatsapp-session", // Backup local session directory
        store: store,
        backupSyncIntervalMs: 300000 // Backup every 5 minutes
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

        // Step 4: Set up event handlers
        setupEventHandlers();

        // Step 5: Initialize the client
        console.log('🔄 Initializing WhatsApp client...');
        await client.initialize();

    } catch (error) {
        console.error('❌ Bot initialization failed:', error.message);
        process.exit(1);
    }
}

// Function to set up all WhatsApp client event handlers
function setupEventHandlers() {
    // WhatsApp authentication events
    client.on('loading_screen', (percent, message) => {
            console.log(`🔄 Loading WhatsApp: ${percent}% - ${message}`);
    });

    client.on('authenticated', () => {
            console.log('✅ WhatsApp session authenticated! (Using saved session)');
    });

        // RemoteAuth specific events
    client.on('remote_session_saved', () => {
            console.log('💾 WhatsApp session saved to MongoDB');
    });

    client.on('remote_session_loaded', () => {
            console.log('📥 WhatsApp session loaded from MongoDB');
    });

    client.on('auth_failure', async (msg) => {
        console.error('❌ WhatsApp authentication failed:', msg);
        console.log('🔄 Session may be invalid. Clearing session...');

        try {
            // Clear the invalid session from MongoDB store
            await store.delete({ session: 'openhands-simple-bot' });
            console.log('🗑️ Cleared invalid session from MongoDB');

            // Also clear local backup session
            const fs = require('fs');
            const sessionPath = './whatsapp-session';
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log('🗑️ Cleared local backup session');
            }

            console.log('🔄 Please restart the bot to scan QR again.');
        } catch (error) {
            console.error('❌ Error clearing session:', error.message);
        }

        process.exit(1);
});

    client.on('disconnected', async (reason) => {
        console.log('🔌 WhatsApp disconnected:', reason);
        if (reason === 'LOGOUT') {
            console.log('🔄 Logged out from WhatsApp. Clearing session...');

            try {
                // Clear session from MongoDB store
                await store.delete({ session: 'openhands-simple-bot' });
                console.log('🗑️ Cleared session from MongoDB');

                // Also clear local backup session
                const fs = require('fs');
                const sessionPath = './whatsapp-session';
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log('🗑️ Cleared local backup session');
                }

                console.log('🔄 Please restart the bot to scan QR again.');
            } catch (error) {
                console.error('❌ Error clearing session:', error.message);
            }
        }
});

    client.on('qr', (qr) => {
        console.log('\n📱 FIRST TIME SETUP - SCAN THIS QR CODE:');
        console.log('==========================================');
        console.log('⚠️  You only need to scan this ONCE!');
        console.log('⚠️  After scanning, the session will be saved to MongoDB for future use.');
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

        console.log('\n🎉 Bot is ready! Send a WhatsApp message to chat with OpenHands agent.');
        console.log('📝 Example: "Create a Python script that prints Hello World"');
        console.log('🔄 To restart the bot later, just run: npm run whatsapp-simple');
        console.log('💡 Each WhatsApp number will have its own persistent conversation.');
});

// MongoDB conversation management functions
async function findExistingConversation(phoneNumber) {
    try {
        const conversation = await Conversation.findOne({ phone_number: phoneNumber });
        return conversation;
    } catch (error) {
        console.error('❌ Error finding conversation:', error.message);
        return null;
    }
}

async function createNewConversationRecord(phoneNumber, name, conversationId) {
    try {
        const conversation = new Conversation({
            phone_number: phoneNumber,
            name: name,
            conversation_id: conversationId,
            updated_at: new Date()
        });
        await conversation.save();
        console.log(`✅ Saved conversation record for ${phoneNumber}`);
        return conversation;
    } catch (error) {
        console.error('❌ Error saving conversation:', error.message);
        return null;
    }
}

async function updateConversationTimestamp(phoneNumber) {
    try {
        await Conversation.updateOne(
            { phone_number: phoneNumber },
            { updated_at: new Date() }
        );
    } catch (error) {
        console.error('❌ Error updating conversation timestamp:', error.message);
    }
}

async function initializeConversationForUser(phoneNumber, userName) {
    try {
        // Use the new conversation management function
        currentConversationId = await getOrCreateConversation(phoneNumber, userName);

        // Connect WebSocket for this conversation
        await connectWebSocket();
        await waitForAgentReady();

    } catch (error) {
        console.error('❌ Failed to initialize conversation:', error.message);
        throw error;
    }
}

// WhatsApp message event
    client.on('message', async (message) => {
        if (message.fromMe) return; // Ignore messages sent by the bot

        const contact = await message.getContact();
        const chat = await message.getChat();
        const userName = contact.pushname || contact.number;
        const phoneNumber = contact.number;

        console.log(`\n📨 Message from ${userName} (${phoneNumber}): "${message.body}"`);

        // Set current chat and user info for responses
        currentWhatsAppChat = chat;
        currentUserPhoneNumber = phoneNumber;
        currentUserName = userName;

        // Check if we need to initialize conversation for this user
        if (!currentConversationId || currentUserPhoneNumber !== phoneNumber) {
            console.log(`🔍 Checking conversation for ${phoneNumber}...`);
            await initializeConversationForUser(phoneNumber, userName);
        }

        // Update conversation timestamp
        await updateConversationTimestamp(phoneNumber);

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
}

async function initializeConversationForUser(phoneNumber, userName) {
    try {
        // Use the new conversation management function
        currentConversationId = await getOrCreateConversation(phoneNumber, userName);

        // Connect WebSocket for this conversation
        await connectWebSocket();
        await waitForAgentReady();

    } catch (error) {
        console.error('❌ Failed to initialize conversation:', error.message);
        throw error;
    }
}

// WebSocket connection
async function connectWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('🔌 Connecting to WebSocket...');

        // Disconnect existing socket if any
        if (openhandsSocket) {
            openhandsSocket.disconnect();
            openhandsSocket = null;
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

    // Track agent state (internal only, don't send to WhatsApp)
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
        return; // Don't send state changes to WhatsApp
    }

    // Filter messages similar to frontend logic

    // 1. Handle user messages (echo back for confirmation - optional)
    if (event.source === 'user' && event.action === 'message') {
        // Don't echo user messages back to WhatsApp
        return;
    }

    // 2. Handle agent messages (main responses)
    if (event.source === 'agent' && event.action === 'message' && event.message) {
        if (!shouldFilterMessage(event.message)) {
            sendToWhatsApp(event.message);
        }
        return;
    }

    // 3. Handle finish actions (completion messages)
    if (event.source === 'agent' && event.action === 'finish' && event.message) {
        if (!shouldFilterMessage(event.message)) {
            sendToWhatsApp(`✅ ${event.message}`);
        }
        return;
    }

    // 4. Handle error observations
    if (event.observation === 'error' && event.message) {
        sendToWhatsApp(`❌ Error: ${event.message}`);
        return;
    }

    // 5. Handle user rejection observations
    if (event.observation === 'user_rejected' && event.content) {
        sendToWhatsApp(`🚫 ${event.content}`);
        return;
    }

    // 6. Handle actions with thought property (when they have observation pairs)
    if (MESSAGE_FILTER_CONFIG.showThoughts &&
        event.source === 'agent' && event.args && event.args.thought &&
        (event.action === 'run' || event.action === 'str_replace_editor' || event.action === 'create' || event.action === 'edit')) {
        // Only show thought if it's meaningful and not just system messages
        const thought = event.args.thought.trim();
        if (thought &&
            !thought.includes('You are OpenHands agent') &&
            !thought.includes('I need to') &&
            !thought.startsWith('I should') &&
            !thought.includes('I\'ll help you') &&
            !thought.includes('Let me') &&
            thought.length > 20) {
            sendToWhatsApp(`💭 ${thought}`);
        }
        return;
    }

    // 7. Handle important command results (only show meaningful output)
    if (MESSAGE_FILTER_CONFIG.showCommandOutputs &&
        event.source === 'environment' && event.observation === 'run' && event.content) {
        const output = event.content.trim();
        // Only show output if it's meaningful (not just command confirmations)
        if (output &&
            output.length > 10 &&
            !output.includes('Command executed successfully') &&
            !output.includes('Exit code: 0') &&
            !output.includes('Process completed') &&
            !output.match(/^\s*$/) &&
            !output.match(/^[\s\n]*$/)) {

            // Limit output length for WhatsApp
            const maxLength = MESSAGE_FILTER_CONFIG.maxOutputLength;
            const truncatedOutput = output.length > maxLength
                ? output.substring(0, maxLength) + '...\n(Output truncated)'
                : output;

            sendToWhatsApp(`📋 Output:\n\`\`\`\n${truncatedOutput}\n\`\`\``);
        }
        return;
    }

    // 8. Handle file operations (show brief notifications)
    if (MESSAGE_FILTER_CONFIG.showFileOperations &&
        event.source === 'agent' && (event.action === 'str_replace_editor' || event.action === 'create')) {
        const path = event.args?.path;
        if (path && event.action === 'str_replace_editor') {
            // Only notify for file edits, not views
            if (event.args?.command === 'create' || event.args?.command === 'str_replace') {
                sendToWhatsApp(`📝 ${event.args.command === 'create' ? 'Created' : 'Modified'} file: ${path}`);
            }
        }
        return;
    }

    // Ignore all other events (system messages, state changes, etc.)
    // This includes:
    // - System messages (action: 'system')
    // - Agent state changes
    // - Internal thinking processes
    // - Setup/initialization messages
    // - Raw command actions without meaningful output
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

    // Format and clean the message
    const formattedMessage = formatMessageForWhatsApp(message);

    if (!formattedMessage) {
        console.log('⚠️ Message filtered out (empty after formatting)');
        return;
    }

    try {
        console.log(`📱 Sending to WhatsApp: "${formattedMessage.substring(0, 100)}${formattedMessage.length > 100 ? '...' : ''}"`);
        await currentWhatsAppChat.sendMessage(formattedMessage);
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

    // Close MongoDB connection
    try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
    } catch (error) {
        console.error('❌ Error closing MongoDB:', error.message);
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
console.log('🚀 Starting WhatsApp Bot...');
console.log('⏳ Initializing MongoDB and WhatsApp client...');
initializeBot();
