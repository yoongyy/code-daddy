const { io } = require('socket.io-client');
const axios = require('axios');

class OpenHandsWebSocketTest {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.socket = null;
        this.conversationId = null;
        this.isConnected = false;
        this.events = [];
    }

    async createSettings() {
        try {
            console.log('⚙️ Creating settings...');

            const headers = {
                'Content-Type': 'application/json'
            };

            // Add session API key for authentication
            const sessionApiKey = process.env.SESSION_API_KEY || '175856fd-7dfa-4f67-88e8-1dbf076a8f99';
            if (sessionApiKey) {
                headers['X-Session-API-Key'] = sessionApiKey;
            }

            // Create minimal settings required for conversation
            const settings = {
                llm_model: 'gpt-3.5-turbo',
                llm_api_key: 'test-api-key-for-websocket-testing', // Mock API key for testing
                agent: 'CodeActAgent',
                language: 'en',
                max_iterations: 30,
                enable_default_condenser: true,
                enable_sound_notifications: false,
                enable_proactive_conversation_starters: true,
                secrets_store: {
                    provider_tokens: {},
                    custom_secrets: {}
                }
            };

            const response = await axios.post(`${this.baseUrl}/api/settings`, settings, {
                headers,
                timeout: 10000
            });

            console.log('✅ Settings created successfully');
            return true;
        } catch (error) {
            console.log('❌ Error creating settings:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
                console.log('Response status:', error.response.status);
            }
            return false;
        }
    }

    async createConversation(initialMessage = "Hello, I need help with a coding task.") {
        try {
            console.log('🚀 Creating new conversation...');

            const headers = {
                'Content-Type': 'application/json'
            };

            // Add session API key for authentication
            const sessionApiKey = process.env.SESSION_API_KEY || '175856fd-7dfa-4f67-88e8-1dbf076a8f99';
            if (sessionApiKey) {
                headers['X-Session-API-Key'] = sessionApiKey;
            }

            const response = await axios.post(`${this.baseUrl}/api/conversations`, {
                initial_user_msg: null, // Don't send initial message to avoid LLM auth
                repository: null,
                git_provider: null,
                selected_branch: null,
                image_urls: [],
                replay_json: null,
                suggested_task: null,
                conversation_instructions: null
            }, {
                headers,
                timeout: 10000
            });

            console.log('📋 Response data:', JSON.stringify(response.data, null, 2));

            if (response.data.status === 'success') {
                this.conversationId = response.data.conversation_id;
                console.log(`✅ Conversation created successfully: ${this.conversationId}`);
                return this.conversationId;
            } else if (response.data.conversation_id) {
                // Sometimes the conversation is created even if status is not 'success'
                this.conversationId = response.data.conversation_id;
                console.log(`✅ Conversation created (with warnings): ${this.conversationId}`);
                return this.conversationId;
            } else {
                throw new Error(`Failed to create conversation: ${response.data.message}`);
            }
        } catch (error) {
            console.error('❌ Error creating conversation:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            throw error;
        }
    }

    async connectWebSocket() {
        if (!this.conversationId) {
            throw new Error('No conversation ID available. Create a conversation first.');
        }

        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to WebSocket...');

            // Prepare connection parameters
            const query = {
                conversation_id: this.conversationId,
                latest_event_id: -1,
                providers_set: '', // Empty for basic testing
                session_api_key: process.env.SESSION_API_KEY || '175856fd-7dfa-4f67-88e8-1dbf076a8f99',
            };

            // Create socket connection
            this.socket = io(this.baseUrl, {
                transports: ['websocket'],
                query: query,
                timeout: 10000,
                forceNew: true
            });

            // Connection event handlers
            this.socket.on('connect', () => {
                console.log('✅ WebSocket connected successfully');
                this.isConnected = true;
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error('❌ WebSocket connection error:', error.message);
                this.isConnected = false;
                reject(new Error(`WebSocket connection failed: ${error.message}`));
            });

            this.socket.on('disconnect', (reason) => {
                console.log('🔌 WebSocket disconnected:', reason);
                this.isConnected = false;
            });

            this.socket.on('oh_event', (event) => {
                console.log('📨 Received event:', JSON.stringify(event, null, 2));
                this.events.push(event);
            });

            // No timeout - let it connect when ready
        });
    }

    async sendMessage(message, waitForResponse = true) {
        if (!this.socket || !this.isConnected) {
            throw new Error('WebSocket is not connected');
        }

        console.log(`📤 Sending message: ${message}`);

        const messageEvent = {
            action: 'message',
            args: {
                content: message,
                image_urls: null,
                wait_for_response: waitForResponse
            },
            source: 'user',
            timestamp: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            try {
                let responseReceived = false;
                let agentThinking = false;
                let agentResponses = [];

                // Set up response handler if waiting for response
                if (waitForResponse) {
                    const responseHandler = (event) => {
                        console.log(`📨 Received event: ${event.source} - ${event.action || event.observation || 'status'}`);

                        // Track agent state changes
                        if (event.observation === 'agent_state_changed') {
                            const state = event.extras?.agent_state;
                            console.log(`🤖 Agent state: ${state}`);

                            if (state === 'running' || state === 'thinking') {
                                agentThinking = true;
                                console.log('🧠 Agent is thinking...');
                            } else if (state === 'stopped' || state === 'finished' || state === 'awaiting_user_input') {
                                if (agentThinking) {
                                    console.log(`✅ Agent finished processing (state: ${state})`);
                                    responseReceived = true;
                                    this.socket.off('oh_event', responseHandler);
                                    resolve({
                                        success: true,
                                        finalState: state,
                                        agentResponses,
                                        events: this.events.slice(-10)
                                    });
                                }
                            }
                        }

                        // Collect agent responses
                        if (event.source === 'agent') {
                            agentResponses.push(event);
                            console.log(`🤖 Agent ${event.action || event.observation}: ${event.message || 'No message'}`);

                            // Check for completion indicators
                            if (event.action === 'finish' ||
                                event.action === 'delegate' ||
                                (event.message && (
                                    event.message.includes('task completed') ||
                                    event.message.includes('script created') ||
                                    event.message.includes('file created') ||
                                    event.message.includes('done') ||
                                    event.message.includes('finished')
                                ))) {
                                console.log('✅ Agent provided completion response');
                                responseReceived = true;
                                this.socket.off('oh_event', responseHandler);
                                resolve({
                                    success: true,
                                    finalResponse: event,
                                    agentResponses,
                                    events: this.events.slice(-10)
                                });
                            }
                        }
                    };

                    this.socket.on('oh_event', responseHandler);
                    console.log('⏳ Waiting for agent response (no timeout)...');
                }

                // Send user message to agent
                this.socket.emit('oh_user_action', messageEvent);
                console.log('✅ Message sent successfully');

                if (!waitForResponse) {
                    resolve({ success: true });
                }
            } catch (error) {
                console.error('❌ Error sending message:', error.message);
                reject(error);
            }
        });
    }

    async startConversation(initialMessage = "Hello, I need help with a coding task.") {
        try {
            // Step 1: Create settings
            // const settingsCreated = await this.createSettings();
            // if (!settingsCreated) {
            //     throw new Error('Failed to create settings');
            // }

            // Step 2: Create conversation
            await this.createConversation(initialMessage);

            // Step 3: Connect to WebSocket
            await this.connectWebSocket();

            console.log('🎉 Conversation started successfully!');
            return this.conversationId;
        } catch (error) {
            console.error('❌ Failed to start conversation:', error.message);
            throw error;
        }
    }

    async sendMessageToAgent(message, waitForResponse = true) {
        try {
            console.log(`\n=== Sending Message to Agent ===`);
            const result = await this.sendMessage(message, waitForResponse);

            if (result.timeout) {
                console.log(`⏰ Agent response timed out (${result.reason || 'unknown'})`);
                console.log(`📊 Received ${result.agentResponses?.length || 0} agent responses`);
                if (result.agentResponses?.length > 0) {
                    console.log('🤖 Agent responses received:');
                    result.agentResponses.forEach((response, i) => {
                        console.log(`  ${i + 1}. ${response.action || response.observation}: ${response.message || 'No message'}`);
                    });
                }
            } else if (result.success) {
                console.log(`✅ Agent completed processing (${result.finalState || 'finished'})`);
                console.log(`📊 Received ${result.agentResponses?.length || 0} agent responses`);
                if (result.agentResponses?.length > 0) {
                    console.log('🤖 Agent responses:');
                    result.agentResponses.forEach((response, i) => {
                        console.log(`  ${i + 1}. ${response.action || response.observation}: ${response.message || 'No message'}`);
                    });
                }
            }

            return {
                ...result,
                allEvents: this.events
            };
        } catch (error) {
            console.error('❌ Failed to send message to agent:', error.message);
            throw error;
        }
    }

    disconnect() {
        if (this.socket) {
            console.log('🔌 Disconnecting WebSocket...');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }

    getEvents() {
        return this.events;
    }

    getConversationId() {
        return this.conversationId;
    }

    isWebSocketConnected() {
        return this.isConnected;
    }
}

// Test function
async function runTest() {
    const test = new OpenHandsWebSocketTest();

    try {
        console.log('🧪 Starting OpenHands WebSocket Test...\n');

        // Test 1: Start conversation
        console.log('=== Test 1: Start Conversation ===');
        await test.startConversation("Hello! Can you help me create a simple Python script?");

        // Test 2: Send message to agent and wait for response
        console.log('\n=== Test 2: Send Message to Agent ===');
        const response = await test.sendMessageToAgent("Please create a Python script that prints 'Hello, World!'");

        console.log('\n=== Agent Response Summary ===');
        if (response.success) {
            console.log('✅ Agent successfully completed the task!');
            console.log(`Final state: ${response.finalState}`);
        } else if (response.timeout) {
            console.log('⏰ Agent response timed out, but may have provided partial responses');
        }

        if (response.agentResponses && response.agentResponses.length > 0) {
            console.log(`\n📋 Agent provided ${response.agentResponses.length} responses:`);
            response.agentResponses.forEach((resp, i) => {
                if (resp.message) {
                    console.log(`${i + 1}. ${resp.message}`);
                }
            });
        }

        // Display results
        console.log('\n=== Test Results ===');
        console.log(`Conversation ID: ${test.getConversationId()}`);
        console.log(`WebSocket Connected: ${test.isWebSocketConnected()}`);
        console.log(`Events Received: ${test.getEvents().length}`);

        if (test.getEvents().length > 0) {
            console.log('\nLast few events:');
            test.getEvents().slice(-3).forEach((event, index) => {
                console.log(`Event ${index + 1}:`, JSON.stringify(event, null, 2));
            });
        }

        console.log('\n✅ Test completed successfully!');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    } finally {
        test.disconnect();
    }
}

// Export for use as module
module.exports = OpenHandsWebSocketTest;

// Run test if this file is executed directly
if (require.main === module) {
    // Check if required dependencies are available
    try {
        require('socket.io-client');
        require('axios');
    } catch (error) {
        console.error('❌ Missing dependencies. Please install them:');
        console.error('npm install socket.io-client axios');
        process.exit(1);
    }

    runTest().catch(console.error);
}
