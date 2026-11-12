const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render / Cloud hosting HTTPS reverse proxies
app.set('trust proxy', 1);

// Authorized IDs configuration
const CREATOR_ID = process.env.CREATOR_ID || "459683716634247172";
const ADMIN_IDS = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
    : [
        "817378206520836156",
        "422345185415135232",
        "510792663210131456"
    ];
const TASK_ASSIGNMENTS = {
    "817378206520836156": ["Activity checks", "Ladders"],
    "422345185415135232": ["Activity checks", "Invites", "Yunite presets"],
    "510792663210131456": ["Activity checks", "Ladders"],
    "575312474023133184": ["Recruit Chat Mods", "Help the staff team"]
};
const TASK_VIEWER_IDS = new Set(Object.keys(TASK_ASSIGNMENTS));
const ALL_AUTHORIZED_IDS = new Set([CREATOR_ID, ...ADMIN_IDS]);

// Persistent database: PostgreSQL when DATABASE_URL is set, local JSON otherwise.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
    : null;

let db = {
    level30_archive: [], // array of { id, addedBy: { id, username, avatar }, addedAt }
    logs: [],            // array of { id, action, count, output, user, timestamp }
    settings: {
        lastUpdated: new Date().toISOString()
    }
};

let archiveIdSet = new Set();

function normalizeDatabase() {
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
    archiveIdSet = new Set(db.level30_archive.map(item => item.id));
}

async function initDatabase() {
    if (pool) {
        await pool.query(`CREATE TABLE IF NOT EXISTS admin_ids_state (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            payload JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        const result = await pool.query('SELECT payload FROM admin_ids_state WHERE id = 1');
        if (result.rows.length) {
            db = result.rows[0].payload;
        } else {
            // Import the old local JSON database once when the PostgreSQL table is empty.
            if (fs.existsSync(DB_FILE)) {
                const previous = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                db = { ...db, ...previous };
            }
            normalizeDatabase();
            await saveDatabase();
        }
        console.log(`[DB] PostgreSQL connected. Loaded ${db.level30_archive.length} archive IDs.`);
    } else {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        if (fs.existsSync(DB_FILE)) {
            db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
        }
        normalizeDatabase();
        if (!fs.existsSync(DB_FILE)) await saveDatabase();
        console.log(`[DB] Local JSON mode. Loaded ${db.level30_archive.length} archive IDs.`);
    }
    committedDatabase = JSON.stringify(db);
}

let saveQueue = Promise.resolve();
let committedDatabase = null;

function saveDatabase() {
    const snapshot = JSON.stringify(db);
    if (pool) {
        saveQueue = saveQueue.catch(() => {}).then(() => pool.query(
            `INSERT INTO admin_ids_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
             ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
            [snapshot]
        ));
        return saveQueue;
    }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tempFile = DB_FILE + '.tmp';
        fs.writeFileSync(tempFile, snapshot, 'utf-8');
        fs.renameSync(tempFile, DB_FILE);
        return Promise.resolve();
    } catch (err) {
        console.error('[DB] Error saving database:', err);
        return Promise.reject(new Error('Database persistence failed. Check DATA_DIR and the persistent disk configuration.'));
    }
}

async function persistDatabaseOrRespond(res) {
    try {
        await saveDatabase();
        committedDatabase = JSON.stringify(db);
        return true;
    } catch (err) {
        console.error('[DB] Persistence error:', err.message);
        if (committedDatabase) {
            db = JSON.parse(committedDatabase);
            normalizeDatabase();
        }
        res.status(500).json({ success: false, error: 'Unable to persist the database. Check the database connection.' });
        return false;
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

function canViewTasks(user) {
    return Boolean(user && (user.role === 'creator' || TASK_VIEWER_IDS.has(String(user.id))));
}

// Express Middleware & Security Hardening
app.disable('x-powered-by');

// Security HTTP Headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Basic rate limiter for API endpoints to prevent abuse
const requestTracker = new Map();
function apiRateLimiter(limit = 120, windowMs = 60 * 1000) {
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const info = requestTracker.get(ip) || { count: 0, resetTime: now + windowMs };
        if (now > info.resetTime) {
            info.count = 0;
            info.resetTime = now + windowMs;
        }
        info.count++;
        requestTracker.set(ip, info);
        if (info.count > limit) {
            return res.status(429).json({ success: false, error: "Too many requests. Please slow down." });
        }
        next();
    };
}
app.use('/api/', apiRateLimiter());

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
        return res.status(401).json({ success: false, error: "Authentication required." });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || !isAuthorized(req.user.id)) {
        return res.status(403).json({
            success: false,
            error: "Access denied."
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

// Check auth status & configuration (sensitive admin IDs are strictly kept server-side)
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
        currentUser: req.user ? {
            id: req.user.id,
            username: req.user.username,
            global_name: req.user.global_name,
            avatar: req.user.avatar,
            avatarUrl: req.user.avatarUrl,
            role: req.user.role,
            canAccessAdmin: req.user.canAccessAdmin,
            canViewTasks: canViewTasks(req.user)
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
            canAccessAdmin: req.user.canAccessAdmin,
            canViewTasks: canViewTasks(req.user)
        }
    });
});

// Staff task data is filtered on the server. Only the creator receives the full roster.
app.get('/api/tasks', requireAuth, (req, res) => {
    if (!canViewTasks(req.user)) {
        return res.status(403).json({ success: false, error: "Access denied." });
    }

    const isCreator = req.user.role === 'creator';
    const users = isCreator
        ? Object.entries(TASK_ASSIGNMENTS)
        : [[String(req.user.id), TASK_ASSIGNMENTS[String(req.user.id)]]];
    const assignments = users.map(([id, tasks]) => ({ id, tasks }));
    const firstMonday = new Date('2026-11-16T00:00:00.000Z');
    const cycle = [
        { chatMods: "817378206520836156", helpers: "422345185415135232" },
        { chatMods: "422345185415135232", helpers: "510792663210131456" },
        { chatMods: "510792663210131456", helpers: "817378206520836156" }
    ];
    const rotation = [];
    for (let week = 0; week < 12; week++) {
        const date = new Date(firstMonday);
        date.setUTCDate(firstMonday.getUTCDate() + week * 7);
        const entry = { week: week + 1, startsAt: date.toISOString(), ...cycle[week % cycle.length] };
        if (isCreator || entry.chatMods === String(req.user.id) || entry.helpers === String(req.user.id)) {
            rotation.push(isCreator ? entry : {
                week: entry.week,
                startsAt: entry.startsAt,
                chatMods: entry.chatMods === String(req.user.id) ? entry.chatMods : null,
                helpers: entry.helpers === String(req.user.id) ? entry.helpers : null
            });
        }
    }
    res.json({ success: true, isCreator, assignments, rotation });
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
    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000
    });

    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify&state=${state}`;
    res.redirect(discordAuthUrl);
});

// Discord OAuth2 Callback
app.get('/api/auth/discord/callback', async (req, res) => {
    reloadEnv();
    const { code, state } = req.query;
    const storedState = req.cookies.oauth_state;
    res.clearCookie('oauth_state');

    if (!code || !state || !storedState || state !== storedState) {
        return res.redirect('/?oauth_error=invalid_state');
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
            console.error('[OAuth] Token exchange error');
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
            secure: process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        console.log(`[AUTH] Login successful: ${userData.username} - Role: ${role}`);
        res.redirect('/?login_success=1');
    } catch (err) {
        console.error('[OAuth] Callback error');
        res.redirect('/?oauth_error=internal_error');
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies.session_token || req.headers['x-session-token'];
    if (token) {
        sessions.delete(token);
    }
    res.clearCookie('session_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax'
    });
    res.json({ success: true });
});

// --- LEVEL 30 SHARED ARCHIVE ROUTES ---

// GET /api/level30: Get all archived IDs and details (Restricted to Creator & Admins)
app.get('/api/level30', requireAdmin, (req, res) => {
    const idList = Array.from(archiveIdSet);
    res.json({
        success: true,
        count: idList.length,
        ids: idList,
        items: db.level30_archive,
        lastUpdated: db.settings.lastUpdated
    });
});

// POST /api/level30/add: Add new IDs to the shared archive (Restricted to Creator & Admins)
app.post('/api/level30/add', requireAdmin, async (req, res) => {
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

    if (!await persistDatabaseOrRespond(res)) return;

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
app.delete('/api/level30/id/:id', requireAdmin, async (req, res) => {
    const targetId = req.params.id;
    if (!archiveIdSet.has(targetId)) {
        return res.status(404).json({ success: false, error: "ID not found in archive." });
    }

    archiveIdSet.delete(targetId);
    db.level30_archive = db.level30_archive.filter(item => item.id !== targetId);
    db.settings.lastUpdated = new Date().toISOString();
    if (!await persistDatabaseOrRespond(res)) return;

    broadcastSSE('archive_updated', {
        action: 'delete',
        deletedId: targetId,
        totalCount: archiveIdSet.size
    });

    res.json({ success: true, totalCount: archiveIdSet.size });
});

// POST /api/level30/clear: Empty entire shared archive
app.post('/api/level30/clear', requireAdmin, async (req, res) => {
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

    if (!await persistDatabaseOrRespond(res)) return;

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
app.post('/api/logs/add', requireAdmin, async (req, res) => {
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
    if (!await persistDatabaseOrRespond(res)) return;

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
app.post('/api/backup/import', requireAdmin, async (req, res) => {
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
    if (!await persistDatabaseOrRespond(res)) return;

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

// --- REAL-TIME SSE ENDPOINT (Restricted to Admins) ---
app.get('/api/events', requireAdmin, (req, res) => {
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

// Global error handler to prevent leaking traces or details
app.use((err, req, res, next) => {
    console.error('[SERVER] Internal error caught');
    res.status(500).json({ success: false, error: "Internal server error." });
});

// Start Server
initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`=======================================================`);
        console.log(`🚀 Discord ID Pro Server running!`);
        console.log(`🌐 Port: ${PORT}`);
        console.log(`👑 Creator access configured`);
        console.log(`🛡️ Authorized Admins: ${ADMIN_IDS.length} active`);
        console.log(`📦 Global Archive Count: ${archiveIdSet.size}`);
        console.log(`=======================================================`);
    });
}).catch(err => {
    console.error('[DB] Startup failed; server will not start without a working database:', err.message);
    process.exit(1);
});
