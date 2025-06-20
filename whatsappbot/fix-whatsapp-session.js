const fs = require('fs');
const path = require('path');

console.log('🔧 WhatsApp Session Repair Tool');
console.log('================================');

const sessionDirs = [
    { name: 'simple', path: './whatsapp-session' },
    { name: 'robust', path: './whatsapp-session-robust' },
    { name: 'full', path: './whatsapp-session-full' }
];

function checkSessionHealth(sessionPath) {
    if (!fs.existsSync(sessionPath)) {
        return { status: 'missing', message: 'No session directory' };
    }

    const files = fs.readdirSync(sessionPath);
    if (files.length === 0) {
        return { status: 'empty', message: 'Session directory is empty' };
    }

    // Check for essential session files
    const hasSessionFile = files.some(file => file.includes('session'));
    const hasWABrowserId = files.some(file => file.includes('WA'));

    if (!hasSessionFile && !hasWABrowserId) {
        return { status: 'corrupted', message: 'Missing essential session files' };
    }

    // Check file sizes (corrupted files are often 0 bytes)
    const corruptedFiles = files.filter(file => {
        const filePath = path.join(sessionPath, file);
        const stats = fs.statSync(filePath);
        return stats.size === 0;
    });

    if (corruptedFiles.length > 0) {
        return { status: 'corrupted', message: `${corruptedFiles.length} corrupted files found` };
    }

    return { status: 'healthy', message: `${files.length} files, looks good` };
}

function repairSession(sessionPath) {
    console.log(`🔧 Repairing session: ${sessionPath}`);

    if (fs.existsSync(sessionPath)) {
        // Remove corrupted files
        const files = fs.readdirSync(sessionPath);
        let removedCount = 0;

        files.forEach(file => {
            const filePath = path.join(sessionPath, file);
            const stats = fs.statSync(filePath);

            // Remove 0-byte files
            if (stats.size === 0) {
                fs.unlinkSync(filePath);
                removedCount++;
                console.log(`  🗑️ Removed corrupted file: ${file}`);
            }
        });

        // If too many files were corrupted, remove the entire session
        const remainingFiles = fs.readdirSync(sessionPath);
        if (remainingFiles.length < 2) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`  🗑️ Session too corrupted, removed entirely`);
            return 'removed';
        }

        if (removedCount > 0) {
            console.log(`  ✅ Repaired session (removed ${removedCount} corrupted files)`);
            return 'repaired';
        } else {
            console.log(`  ✅ Session appears healthy`);
            return 'healthy';
        }
    }

    return 'missing';
}

function main() {
    console.log('\n📋 Checking session health...');
    console.log('------------------------------');

    let needsRepair = false;

    sessionDirs.forEach(({ name, path: sessionPath }) => {
        const health = checkSessionHealth(sessionPath);
        const statusIcon = {
            'healthy': '✅',
            'missing': '❌',
            'empty': '⚠️',
            'corrupted': '🔴'
        }[health.status] || '❓';

        console.log(`${statusIcon} ${name.padEnd(8)} - ${health.message}`);

        if (health.status === 'corrupted' || health.status === 'empty') {
            needsRepair = true;
        }
    });

    if (needsRepair) {
        console.log('\n🔧 Repairing corrupted sessions...');
        console.log('-----------------------------------');

        sessionDirs.forEach(({ name, path: sessionPath }) => {
            const health = checkSessionHealth(sessionPath);
            if (health.status === 'corrupted' || health.status === 'empty') {
                repairSession(sessionPath);
            }
        });

        console.log('\n✅ Repair complete! Try running your WhatsApp bot again.');
    } else {
        console.log('\n✅ All sessions appear healthy!');
    }

    console.log('\n💡 Tips:');
    console.log('- If bots still hang, try: npm run sessions-clear');
    console.log('- Session corruption can happen if WhatsApp Web logs out');
    console.log('- Always close bots gracefully with Ctrl+C');
}

// Command line options
const command = process.argv[2];

if (command === 'repair') {
    console.log('\n🔧 Force repairing all sessions...');
    sessionDirs.forEach(({ name, path: sessionPath }) => {
        repairSession(sessionPath);
    });
} else if (command === 'clear') {
    console.log('\n🗑️ Clearing all sessions...');
    sessionDirs.forEach(({ name, path: sessionPath }) => {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`🗑️ Cleared ${name} session`);
        }
    });
    console.log('✅ All sessions cleared!');
} else {
    main();
}
