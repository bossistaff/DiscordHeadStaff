const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render / Cloud hosting HTTPS reverse proxies
app.set('trust proxy', 1);

// Authorized IDs configuration
const CREATOR_ID = "459683716634247172";
const ADMIN_IDS = [
    "817378206520836156",
    "422345185415135232",
    "510792663210131456"
];
const ALL_AUTHORIZED_IDS = new Set([CREATOR_ID, ...ADMIN_IDS]);

// Known users metadata
const KNOWN_USERS = {
    "459683716634247172": { username: "Creator", role: "creator", badge: "Creator 👑" },
    "817378206520836156": { username: "Admin 1", role: "admin", badge: "Admin" },
    "422345185415135232": { username: "Admin 2", role: "admin", badge: "Admin" },
    "510792663210131456": { username: "Admin 3", role: "admin", badge: "Admin" }
};

// Database persistence
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial state
let db = {
    level30_archive: [], // array of { id, addedBy: { id, username, avatar }, addedAt }
    logs: [],            // array of { id, action, count, output, user, timestamp }
    settings: {
        lastUpdated: new Date().toISOString()
    }
};

// Load database from file
if (fs.existsSync(DB_FILE)) {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.level30_archive) db.level30_archive = parsed.level30_archive;
        if (parsed.logs) db.logs = parsed.logs;
        if (parsed.settings) db.settings = parsed.settings;
        console.log(`[DB] Loaded ${db.level30_archive.length} IDs in archive and ${db.logs.length} logs.`);
    } catch (e) {
        console.error('[DB] Error reading database, initializing fresh:', e);
    }
} else {
    saveDatabase();
}

// In-memory set of archive IDs for O(1) lookups
let archiveIdSet = new Set(db.level30_archive.map(item => typeof item === 'string' ? item : item.id));

// Normalize archive items to object format
db.level30_archive = db.level30_archive.map(item => {
    if (typeof item === 'string') {
        return {
            id: item,
            addedBy: { id: CREATOR_ID, username: "System / Pre-existing" },
            addedAt: new Date().toISOString()
        };
    }
    return item;
});

function saveDatabase() {
    try {
        const tempFile = DB_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
        fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
        console.error('[DB] Error saving database:', err);
    }
}

// Active Sessions: token -> user
const sessions = new Map();

// SSE Clients for real-time synchronization
let sseClients = [];

function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try {
            client.res.write(payload);
        } catch (e) {
            // Client disconnected
        }
    });
}

// Helper: Determine role
function getRoleForId(id) {
    if (id === CREATOR_ID) return 'creator';
    if (ADMIN_IDS.includes(id)) return 'admin';
    return 'guest';
}

function isAuthorized(id) {
    return ALL_AUTHORIZED_IDS.has(String(id));
}

// Express Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Auth Middleware
function authMiddleware(req, res, next) {
    const token = req.cookies.session_token || req.headers['x-session-token'];
    if (token && sessions.has(token)) {
        req.user = sessions.get(token);
    } else {
        req.user = null;
    }
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: "Unauthorized access. Please login." });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !isAuthorized(req.user.id)) {
        return res.status(403).json({
            success: false,
            error: "Access denied. Only the Creator and authorized Admins can access this section."
        });
    }
    next();
}

app.use(authMiddleware);

// --- AUTH ROUTES ---

// Reload env helper to allow updating .env without requiring a manual server restart
function reloadEnv() {
    try {
        require('dotenv').config({ override: true });
    } catch (e) {}
}

// Check auth status & configuration
app.get('/api/auth/status', (req, res) => {
    reloadEnv();
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const hasClientId = Boolean(clientId && clientId !== 'YOUR_DISCORD_CLIENT_ID');
    const hasClientSecret = Boolean(clientSecret && clientSecret !== 'YOUR_DISCORD_CLIENT_SECRET');
    const isConfigured = hasClientId && hasClientSecret;

    res.json({
        success: true,
        isConfigured,
        creatorId: CREATOR_ID,
        adminIds: ADMIN_IDS,
        currentUser: req.user ? {
            id: req.user.id,
            username: req.user.username,
            global_name: req.user.global_name,
            avatar: req.user.avatar,
            avatarUrl: req.user.avatarUrl,
            role: req.user.role,
            canAccessAdmin: req.user.canAccessAdmin
        } : null
    });
});

// Current user profile
app.get('/api/auth/me', (req, res) => {
    if (!req.user) {
        return res.json({ authenticated: false, user: null });
    }
    res.json({
        authenticated: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            global_name: req.user.global_name,
            avatar: req.user.avatar,
            avatarUrl: req.user.avatarUrl,
            role: req.user.role,
            canAccessAdmin: req.user.canAccessAdmin
        }
    });
});

// Discord OAuth2 Redirect
app.get('/api/auth/discord', (req, res) => {
    reloadEnv();
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://discordheadstaff.onrender.com/api/auth/discord/callback';

    if (!clientId || clientId === 'YOUR_DISCORD_CLIENT_ID') {
        return res.redirect('/?oauth_error=not_configured');
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 10 * 60 * 1000 });

    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify&state=${state}`;
    res.redirect(discordAuthUrl);
});

// Discord OAuth2 Callback
app.get('/api/auth/discord/callback', async (req, res) => {
    reloadEnv();
    const { code } = req.query;

    if (!code) {
        return res.redirect('/?oauth_error=no_code');
    }

    try {
        const clientId = process.env.DISCORD_CLIENT_ID;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        const redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://discordheadstaff.onrender.com/api/auth/discord/callback';

        // 1. Exchange code for access token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            })
        });

        if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error('[OAuth] Token exchange error:', errBody);
            return res.redirect('/?oauth_error=token_exchange_failed');
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        // 2. Fetch user profile from Discord
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!userRes.ok) {
            console.error('[OAuth] Error fetching Discord user profile');
            return res.redirect('/?oauth_error=user_fetch_failed');
        }

        const userData = await userRes.json();
        const userId = String(userData.id);
        const role = getRoleForId(userId);
        const canAccessAdmin = isAuthorized(userId);

        const avatarUrl = userData.avatar
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(userData.id) >> 22n) % 6n}.png`;

        const userSession = {
            id: userId,
            username: userData.username,
            global_name: userData.global_name || userData.username,
            avatar: userData.avatar,
            avatarUrl,
            role,
            canAccessAdmin,
            loginAt: new Date().toISOString()
        };

        const sessionToken = crypto.randomBytes(32).toString('hex');
        sessions.set(sessionToken, userSession);

        res.cookie('session_token', sessionToken, {
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        console.log(`[AUTH] Login successful: ${userData.username} (${userId}) - Role: ${role}`);
        res.redirect('/?login_success=1');
    } catch (err) {
        console.error('[OAuth] Callback error:', err);
        res.redirect('/?oauth_error=internal_error');
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies.session_token || req.headers['x-session-token'];
    if (token) {
        sessions.delete(token);
    }
    res.clearCookie('session_token');
    res.json({ success: true });
});

// --- LEVEL 30 SHARED ARCHIVE ROUTES ---

// GET /api/level30: Get all archived IDs and details
app.get('/api/level30', (req, res) => {
    const idList = Array.from(archiveIdSet);
    res.json({
        success: true,
        count: idList.length,
        ids: idList,
        items: req.user && req.user.canAccessAdmin ? db.level30_archive : undefined,
        lastUpdated: db.settings.lastUpdated
    });
});

// POST /api/level30/add: Add new IDs to the shared archive (Restricted to Creator & Admins)
app.post('/api/level30/add', requireAdmin, (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ success: false, error: "Invalid format: array of IDs expected." });
    }

    const validIds = ids
        .map(id => String(id).trim())
        .filter(id => /^\d{16,21}$/.test(id));

    if (validIds.length === 0) {
        return res.status(400).json({ success: false, error: "No valid Discord IDs provided." });
    }

    const uniqueNew = [...new Set(validIds)].filter(id => !archiveIdSet.has(id));

    if (uniqueNew.length === 0) {
        return res.json({
            success: true,
            addedCount: 0,
            alreadyExistingCount: validIds.length,
            totalCount: archiveIdSet.size,
            message: "All provided IDs are already in the shared archive."
        });
    }

    const now = new Date().toISOString();
    const userInfo = {
        id: req.user.id,
        username: req.user.global_name || req.user.username,
        avatarUrl: req.user.avatarUrl,
        role: req.user.role
    };

    // Add to archive set & db
    uniqueNew.forEach(id => {
        archiveIdSet.add(id);
        db.level30_archive.push({
            id,
            addedBy: userInfo,
            addedAt: now
        });
    });

    db.settings.lastUpdated = now;

    // Add shared audit log
    const logEntry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        action: 'Level 30 Filter (Addition)',
        count: uniqueNew.length,
        output: uniqueNew.join('\n'),
        user: userInfo,
        timestamp: now
    };
    db.logs.unshift(logEntry);
    if (db.logs.length > 100) db.logs.length = 100;

    saveDatabase();

    // Broadcast SSE update to all connected clients
    broadcastSSE('archive_updated', {
        action: 'add',
        addedCount: uniqueNew.length,
        totalCount: archiveIdSet.size,
        addedBy: userInfo,
        newIds: uniqueNew
    });

    console.log(`[ARCHIVE] ${userInfo.username} (${userInfo.id}) added ${uniqueNew.length} new IDs.`);

    res.json({
        success: true,
        addedCount: uniqueNew.length,
        totalCount: archiveIdSet.size,
        newIds: uniqueNew,
        ids: Array.from(archiveIdSet)
    });
});

// DELETE /api/level30/id/:id: Remove single ID from shared archive
app.delete('/api/level30/id/:id', requireAdmin, (req, res) => {
    const targetId = req.params.id;
    if (!archiveIdSet.has(targetId)) {
        return res.status(404).json({ success: false, error: "ID not found in archive." });
    }

    archiveIdSet.delete(targetId);
    db.level30_archive = db.level30_archive.filter(item => item.id !== targetId);
    db.settings.lastUpdated = new Date().toISOString();
    saveDatabase();

    broadcastSSE('archive_updated', {
        action: 'delete',
        deletedId: targetId,
        totalCount: archiveIdSet.size
    });

    res.json({ success: true, totalCount: archiveIdSet.size });
});

// POST /api/level30/clear: Empty entire shared archive
app.post('/api/level30/clear', requireAdmin, (req, res) => {
    const previousCount = archiveIdSet.size;
    archiveIdSet.clear();
    db.level30_archive = [];
    db.settings.lastUpdated = new Date().toISOString();

    const userInfo = {
        id: req.user.id,
        username: req.user.global_name || req.user.username,
        role: req.user.role
    };

    const logEntry = {
        id: 'log_' + Date.now(),
        action: 'Complete Archive Reset',
        count: previousCount,
        output: `Archive cleared by ${userInfo.username} (${previousCount} IDs removed).`,
        user: userInfo,
        timestamp: new Date().toISOString()
    };
    db.logs.unshift(logEntry);

    saveDatabase();

    broadcastSSE('archive_updated', {
        action: 'clear',
        totalCount: 0,
        clearedBy: userInfo
    });

    res.json({ success: true, message: "Archive cleared successfully." });
});

// --- LOGS ROUTES ---

// GET /api/logs: Get shared logs (Admin only)
app.get('/api/logs', requireAdmin, (req, res) => {
    res.json({
        success: true,
        logs: db.logs
    });
});

// POST /api/logs/add: Add custom log (Admin only)
app.post('/api/logs/add', requireAdmin, (req, res) => {
    const { action, count, output } = req.body;
    const logEntry = {
        id: 'log_' + Date.now(),
        action: action || 'ID Processing',
        count: count || 0,
        output: output || '',
        user: {
            id: req.user.id,
            username: req.user.global_name || req.user.username,
            avatarUrl: req.user.avatarUrl,
            role: req.user.role
        },
        timestamp: new Date().toISOString()
    };
    db.logs.unshift(logEntry);
    if (db.logs.length > 100) db.logs.length = 100;
    saveDatabase();

    res.json({ success: true, log: logEntry });
});

// --- SETTINGS / BACKUP ROUTES ---

// GET /api/backup: Export complete database (Admin only)
app.get('/api/backup', requireAdmin, (req, res) => {
    const backupData = {
        version: "2.0.0",
        exportDate: new Date().toISOString(),
        exportedBy: req.user.username,
        level30_history: Array.from(archiveIdSet),
        level30_archive: db.level30_archive,
        logs: db.logs
    };
    res.setHeader('Content-Disposition', `attachment; filename=backup_discord_ids_global_${Date.now()}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backupData, null, 2));
});

// POST /api/backup/import: Import backup into global archive (Admin only)
app.post('/api/backup/import', requireAdmin, (req, res) => {
    const { data } = req.body;
    if (!data) {
        return res.status(400).json({ success: false, error: "No backup data provided." });
    }

    let idsToImport = [];
    if (Array.isArray(data.level30_history)) {
        idsToImport = data.level30_history;
    } else if (Array.isArray(data.level30_archive)) {
        idsToImport = data.level30_archive.map(item => typeof item === 'string' ? item : item.id);
    } else if (Array.isArray(data)) {
        idsToImport = data;
    }

    const validIds = idsToImport
        .map(id => String(id).trim())
        .filter(id => /^\d{16,21}$/.test(id));

    const newlyAdded = [];
    const now = new Date().toISOString();
    const userInfo = {
        id: req.user.id,
        username: req.user.global_name || req.user.username,
        role: req.user.role
    };

    validIds.forEach(id => {
        if (!archiveIdSet.has(id)) {
            archiveIdSet.add(id);
            newlyAdded.push(id);
            db.level30_archive.push({
                id,
                addedBy: userInfo,
                addedAt: now
            });
        }
    });

    db.settings.lastUpdated = now;
    saveDatabase();

    broadcastSSE('archive_updated', {
        action: 'import',
        addedCount: newlyAdded.length,
        totalCount: archiveIdSet.size,
        importedBy: userInfo
    });

    res.json({
        success: true,
        importedCount: newlyAdded.length,
        totalCount: archiveIdSet.size
    });
});

// --- REAL-TIME SSE ENDPOINT ---
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now() + Math.random().toString(36).substring(2, 7);
    const client = { id: clientId, res };
    sseClients.push(client);

    // Initial ping
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, archiveCount: archiveIdSet.size })}\n\n`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
});

// --- STATIC ASSETS ---
// Serve index.html
app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 Discord ID Pro Server running!`);
    console.log(`🌐 Port: ${PORT}`);
    console.log(`👑 Creator: ${CREATOR_ID}`);
    console.log(`🛡️ Authorized Admins: ${ADMIN_IDS.join(', ')}`);
    console.log(`📦 Global Archive Count: ${archiveIdSet.size}`);
    console.log(`=======================================================`);
});
