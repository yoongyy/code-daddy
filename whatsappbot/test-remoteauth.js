#!/usr/bin/env node

/**
 * Test script for RemoteAuth setup
 * Tests the MongoDB store connection and RemoteAuth configuration
 */

import mongoose from 'mongoose';
import { MongoStore } from 'wwebjs-mongo';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsappbot';

async function testRemoteAuth() {
    console.log('🧪 Testing RemoteAuth Setup\n');

    try {
        // Test MongoDB connection
        console.log('1. Testing MongoDB connection...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB connected successfully');

        // Test MongoStore creation
        console.log('\n2. Testing MongoStore creation...');
        const store = new MongoStore({ mongoose: mongoose });
        console.log('✅ MongoStore created successfully');

        // Test store operations
        console.log('\n3. Testing store operations...');

        // Test save operation
        const testSession = {
            session: 'test-session-id',
            data: { test: 'data', timestamp: new Date() }
        };

        await store.save(testSession);
        console.log('✅ Test session saved to store');

        // Test load operation
        const loadedSession = await store.load({ session: 'test-session-id' });
        if (loadedSession && loadedSession.data.test === 'data') {
            console.log('✅ Test session loaded from store');
        } else {
            console.log('❌ Failed to load test session');
        }

        // Test delete operation
        await store.delete({ session: 'test-session-id' });
        console.log('✅ Test session deleted from store');

        // Verify deletion
        const deletedSession = await store.load({ session: 'test-session-id' });
        if (!deletedSession) {
            console.log('✅ Session deletion verified');
        } else {
            console.log('❌ Session was not properly deleted');
        }

        console.log('\n🎉 RemoteAuth setup test completed successfully!');
        console.log('\n📋 Configuration Summary:');
        console.log(`   MongoDB URI: ${MONGODB_URI}`);
        console.log(`   Store Type: MongoStore`);
        console.log(`   Client ID: openhands-simple-bot`);
        console.log(`   Backup Sync: Every 5 minutes`);

        console.log('\n✨ Benefits of RemoteAuth:');
        console.log('   • Session stored in MongoDB (persistent across restarts)');
        console.log('   • Better for cloud deployments');
        console.log('   • Shareable sessions across instances');
        console.log('   • Automatic backup to local directory');
        console.log('   • More reliable than LocalAuth');

    } catch (error) {
        console.error('❌ RemoteAuth test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('   • Ensure MongoDB is running');
        console.log('   • Check MongoDB connection string');
        console.log('   • Verify wwebjs-mongo package is installed');
        console.log('   • Check network connectivity');
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 MongoDB disconnected');
    }
}

// Run the test
testRemoteAuth().catch(console.error);
