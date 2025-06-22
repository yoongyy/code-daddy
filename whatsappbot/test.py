#!/usr/bin/env python3
"""
Test script to demonstrate OpenHands WebSocket API usage.
This script creates a conversation, starts it, connects to WebSocket, and sends a message.
"""

import asyncio
import json
import requests
import socketio
from datetime import datetime
import sys
import time

class OpenHandsTestClient:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.sio = socketio.AsyncClient()
        self.conversation_id = None
        self.session_api_key = None
        self.connected = False
        self.events_received = []

        # Set up event handlers
        self.sio.on('connect', self.on_connect)
        self.sio.on('disconnect', self.on_disconnect)
        self.sio.on('oh_event', self.on_event)
        self.sio.on('connect_error', self.on_error)

    async def create_conversation(self, initial_message=None):
        """Create a new conversation"""
        print(f"🔄 Creating conversation...")
        url = f"{self.base_url}/api/conversations"

        payload = {}
        if initial_message:
            payload["initial_user_msg"] = initial_message

        try:
            response = requests.post(url, json=payload, timeout=10)

            if response.status_code == 200:
                data = response.json()
                self.conversation_id = data["conversation_id"]
                print(f"✅ Created conversation: {self.conversation_id}")
                return data
            else:
                print(f"❌ Failed to create conversation: {response.status_code}")
                print(f"Response: {response.text}")
                return None
        except Exception as e:
            print(f"❌ Error creating conversation: {e}")
            return None

    async def start_conversation(self):
        """Start the agent loop for the conversation"""
        if not self.conversation_id:
            print("❌ No conversation ID. Create a conversation first.")
            return None

        print(f"🔄 Starting conversation...")
        url = f"{self.base_url}/api/conversations/{self.conversation_id}/start"

        try:
            response = requests.post(url, timeout=10)

            if response.status_code == 200:
                data = response.json()
                print(f"✅ Started conversation: {self.conversation_id}")
                return data
            else:
                print(f"❌ Failed to start conversation: {response.status_code}")
                print(f"Response: {response.text}")
                return None
        except Exception as e:
            print(f"❌ Error starting conversation: {e}")
            return None

    async def get_conversation_info(self):
        """Get conversation information including session_api_key"""
        if not self.conversation_id:
            print("❌ No conversation ID. Create a conversation first.")
            return None

        print(f"🔄 Getting conversation info...")
        url = f"{self.base_url}/api/conversations/{self.conversation_id}"

        try:
            response = requests.get(url, timeout=10)

            if response.status_code == 200:
                data = response.json()
                self.session_api_key = data.get("session_api_key")
                print(f"✅ Got conversation info. Session API key: {'Yes' if self.session_api_key else 'No'}")
                return data
            else:
                print(f"❌ Failed to get conversation info: {response.status_code}")
                print(f"Response: {response.text}")
                return None
        except Exception as e:
            print(f"❌ Error getting conversation info: {e}")
            return None

    async def connect_websocket(self):
        """Connect to the WebSocket"""
        if not self.conversation_id:
            print("❌ No conversation ID. Create a conversation first.")
            return False

        print(f"🔄 Connecting to WebSocket...")

        # Get conversation info to get session_api_key
        await self.get_conversation_info()

        # Prepare query parameters
        query = {
            "conversation_id": self.conversation_id,
            "latest_event_id": -1,
            "providers_set": "",  # Add provider types if needed
        }

        if self.session_api_key:
            query["session_api_key"] = self.session_api_key

        try:
            # Extract host from base URL
            ws_url = self.base_url.replace("http://", "").replace("https://", "")

            # Connect to WebSocket
            await self.sio.connect(f"ws://{ws_url}", socketio_path="/socket.io/", query=query)

            # Wait for connection to be established
            for i in range(10):  # Wait up to 10 seconds
                if self.connected:
                    break
                await asyncio.sleep(1)

            if self.connected:
                print("✅ Connected to WebSocket")
                return True
            else:
                print("❌ WebSocket connection timeout")
                return False

        except Exception as e:
            print(f"❌ Error connecting to WebSocket: {e}")
            return False

    async def send_message(self, content, image_urls=None):
        """Send a user message to the agent"""
        if not self.sio.connected:
            print("❌ WebSocket not connected")
            return False

        print(f"🔄 Sending message: {content}")

        message_event = {
            "action": "message",
            "args": {
                "content": content,
                "image_urls": image_urls or [],
                "timestamp": datetime.now().isoformat()
            }
        }

        try:
            await self.sio.emit("oh_user_action", message_event)
            print(f"✅ Sent message successfully")
            return True
        except Exception as e:
            print(f"❌ Error sending message: {e}")
            return False

    async def on_connect(self):
        print("🔗 WebSocket connected!")
        self.connected = True

    async def on_disconnect(self):
        print("🔌 WebSocket disconnected!")
        self.connected = False

    async def on_event(self, data):
        """Handle incoming events from the agent"""
        self.events_received.append(data)
        event_type = data.get("action", "unknown")
        source = data.get("source", "unknown")

        print(f"📨 Received event: {source}/{event_type}")

        # Handle different event types
        if source == "agent":
            if event_type == "message":
                thought = data.get("args", {}).get("thought", "")
                if thought:
                    print(f"🤖 Agent: {thought}")
            elif event_type == "run":
                command = data.get("args", {}).get("command", "")
                print(f"🔧 Agent running: {command}")
            elif event_type == "finish":
                final_thought = data.get("args", {}).get("final_thought", "")
                print(f"🏁 Agent finished: {final_thought}")
            elif event_type == "think":
                thought = data.get("args", {}).get("thought", "")
                print(f"💭 Agent thinking: {thought}")

        # Print full event for debugging (optional)
        if len(sys.argv) > 1 and sys.argv[1] == "--verbose":
            print(f"📋 Full event: {json.dumps(data, indent=2)}")

    async def on_error(self, data):
        print(f"❌ WebSocket error: {data}")

    async def disconnect(self):
        """Disconnect from WebSocket"""
        if self.sio.connected:
            await self.sio.disconnect()
            print("🔌 Disconnected from WebSocket")

async def test_websocket_api():
    """Test the complete WebSocket API workflow"""
    print("🚀 Starting OpenHands WebSocket API Test")
    print("=" * 50)

    client = OpenHandsTestClient("http://localhost:3000")

    try:
        # Step 1: Create a new conversation
        result = await client.create_conversation(
            initial_message="Hello! Please create a simple Python script that prints 'Hello, World!' and save it to a file called hello.py"
        )
        if not result:
            print("❌ Failed to create conversation. Is the OpenHands server running?")
            return False

        # Step 2: Start the conversation
        result = await client.start_conversation()
        if not result:
            print("❌ Failed to start conversation")
            return False

        # Step 3: Connect to WebSocket
        connected = await client.connect_websocket()
        if not connected:
            print("❌ Failed to connect to WebSocket")
            return False

        # Step 4: Send additional messages
        print("\n🔄 Waiting for initial agent response...")
        await asyncio.sleep(5)  # Wait for initial processing

        await client.send_message("Great! Now can you also add a comment explaining what the script does?")

        # Step 5: Wait for responses
        print("\n🔄 Waiting for agent responses...")
        await asyncio.sleep(15)  # Wait for agent to process and respond

        # Step 6: Send another message
        await client.send_message("Perfect! Can you show me the contents of the file you created?")

        # Wait for final responses
        await asyncio.sleep(10)

        print(f"\n📊 Test completed! Received {len(client.events_received)} events from the agent.")

        if len(client.events_received) > 0:
            print("✅ WebSocket API is working correctly!")
            return True
        else:
            print("⚠️  No events received from agent. Check server logs.")
            return False

    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        return False
    finally:
        await client.disconnect()

def check_server_health():
    """Check if the OpenHands server is running"""
    try:
        response = requests.get("http://localhost:3000/api/health", timeout=5)
        if response.status_code == 200:
            print("✅ OpenHands server is running")
            return True
        else:
            print(f"⚠️  Server responded with status: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Cannot connect to OpenHands server: {e}")
        print("💡 Make sure the server is running on http://localhost:3000")
        return False

if __name__ == "__main__":
    print("OpenHands WebSocket API Test Script")
    print("Usage: python test_websocket_api.py [--verbose]")
    print()

    # Check server health first
    if not check_server_health():
        sys.exit(1)

    # Run the test
    success = asyncio.run(test_websocket_api())

    if success:
        print("\n🎉 All tests passed!")
        sys.exit(0)
    else:
        print("\n💥 Some tests failed!")
        sys.exit(1)
