const fs = require('fs');
const path = require('path');

console.log('🔧 WhatsApp Session Manager');
console.log('============================');

const sessionDirs = [
    './whatsapp-session',
    './whatsapp-session-robust',
    './whatsapp-session-full'
];

function checkSessions() {
    console.log('\n📋 Session Status:');
    console.log('------------------');

    sessionDirs.forEach(dir => {
        const exists = fs.existsSync(dir);
        const botName = dir.replace('./whatsapp-session', '').replace('-', '') || 'simple';

        if (exists) {
            const files = fs.readdirSync(dir);
            console.log(`✅ ${botName.padEnd(8)} - Session saved (${files.length} files)`);
        } else {
            console.log(`❌ ${botName.padEnd(8)} - No session (will need QR scan)`);
        }
    });
}

function clearSessions() {
    console.log('\n🗑️  Clearing all sessions...');

    sessionDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            const botName = dir.replace('./whatsapp-session', '').replace('-', '') || 'simple';
            console.log(`🗑️  Cleared ${botName} session`);
        }
    });

    console.log('✅ All sessions cleared. Next run will require QR scan.');
}

function clearSpecificSession(botType) {
    const sessionMap = {
        'simple': './whatsapp-session',
        'robust': './whatsapp-session-robust',
        'full': './whatsapp-session-full'
    };

    const dir = sessionMap[botType];
    if (!dir) {
        console.log(`❌ Unknown bot type: ${botType}`);
        console.log('Available types: simple, robust, full');
        return;
    }

    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`🗑️  Cleared ${botType} session`);
    } else {
        console.log(`ℹ️  No session found for ${botType}`);
    }
}

// Command line interface
const command = process.argv[2];

switch (command) {
    case 'check':
    case 'status':
        checkSessions();
        break;

    case 'clear':
        if (process.argv[3]) {
            clearSpecificSession(process.argv[3]);
        } else {
            clearSessions();
        }
        break;

    case 'help':
    default:
        console.log('\n📖 Usage:');
        console.log('----------');
        console.log('node manage-sessions.js check     - Check session status');
        console.log('node manage-sessions.js clear     - Clear all sessions');
        console.log('node manage-sessions.js clear simple  - Clear specific bot session');
        console.log('node manage-sessions.js clear robust  - Clear robust bot session');
        console.log('node manage-sessions.js clear full    - Clear full bot session');
        console.log('');
        console.log('💡 Tips:');
        console.log('- Sessions are automatically saved after first QR scan');
        console.log('- Each bot type has its own session directory');
        console.log('- Clear sessions if you want to use a different WhatsApp account');
        console.log('- Sessions persist between bot restarts');
        break;
}

if (!command) {
    checkSessions();
}
