import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. CSS additions
css_additions = """        body.light-mode {
            --bg-dark: #f0f2f5;
            --card-bg: rgba(255, 255, 255, 0.8);
            --card-border: rgba(0, 0, 0, 0.1);
            --text-main: #1a1c23;
            --text-dim: #4a5568;
        }

        body.light-mode .output-box, body.light-mode textarea {
            background: rgba(0, 0, 0, 0.05);
            color: #1a1c23;
        }

        body.light-mode h1 {
            background: linear-gradient(135deg, #1a1c23 0%, #4a5568 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 15px;
            margin-top: 30px;
            width: 95%;
            max-width: 900px;
            z-index: 10;
        }
        
        .header-banner {
            width: 100%;
            max-height: 200px;
            object-fit: cover;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }

        .header-logo {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            box-shadow: 0 5px 20px rgba(0,0,0,0.5);
            margin-top: -65px;
            border: 4px solid var(--bg-dark);
            background: var(--bg-dark);
            object-fit: cover;
        }

        .logs-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 16px;
        }
        
        .log-item {
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid var(--card-border);
            padding: 16px;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .log-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .log-time {
            font-size: 0.8rem;
            color: var(--text-dim);
        }
        
        .log-details {
            font-weight: 600;
            color: var(--primary);
        }
"""
content = content.replace("        /* Ambient Background Blur Elements */", css_additions + "\n        /* Ambient Background Blur Elements */")


# 2. Header and Nav Additions
nav_target = """    <div class="nav-container">
        <button class="nav-item active" onclick="switchPage('standard')">Standard</button>
        <button class="nav-item" onclick="switchPage('level30')">
            Level 30 <span id="historyCountBadge" class="badge">0</span>
        </button>
        <button class="nav-item" onclick="switchPage('settings')">Settings</button>
    </div>"""

nav_replacement = """    <div class="header-container">
        <img src="assets/banner.png" alt="Noble Practice Banner" class="header-banner" onerror="this.style.display='none'">
        <img src="assets/logo.jpg" alt="Logo" class="header-logo" onerror="this.style.display='none'">
    </div>

    <div class="nav-container">
        <button class="nav-item active" onclick="switchPage('standard')">Standard</button>
        <button class="nav-item" onclick="switchPage('level30')">
            Level 30 <span id="historyCountBadge" class="badge">0</span>
        </button>
        <button class="nav-item" onclick="switchPage('logs')">Logs</button>
        <button class="nav-item" onclick="switchPage('settings')">Settings</button>
        <button class="nav-item" id="themeToggle" onclick="toggleTheme()" title="Toggle Light/Dark Mode" style="margin-left: auto;">☀️</button>
    </div>"""

content = content.replace(nav_target, nav_replacement)


# 3. Custom Prefix/Suffix Inputs
prefix_suffix = """            <div class="options-row">
                <label class="option-item" style="flex: 1; min-width: 120px;">
                    <input type="text" id="customPrefix" placeholder="Custom Prefix (e.g. /ban )" style="width:100%; padding: 8px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(0,0,0,0.3); color: var(--text-main); font-family: var(--font-main);">
                </label>
                <label class="option-item" style="flex: 1; min-width: 120px;">
                    <input type="text" id="customSuffix" placeholder="Custom Suffix" style="width:100%; padding: 8px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(0,0,0,0.3); color: var(--text-main); font-family: var(--font-main);">
                </label>
            </div>
"""

options_target = """            <div class="options-row">
                <label class="option-item"><input type="checkbox" id="sortDesc"> Sort Descending</label>"""
                
content = content.replace(options_target, prefix_suffix + options_target)

# 4. Logs Page HTML
settings_target = """        <!-- PAGE: SETTINGS -->"""
logs_html = """        <!-- PAGE: LOGS -->
        <div id="page-logs" class="page">
            <h1>Session Logs</h1>
            <p class="subtitle">History of processed lists during this session.</p>
            
            <div id="logsContainer" class="logs-list">
                <div style="text-align: center; color: var(--text-dim); padding: 20px;">No logs yet. Process some IDs to see them here.</div>
            </div>
        </div>

"""
content = content.replace(settings_target, logs_html + settings_target)

# 5. JS Log tracking and Theme
js_init_target = """        // State Management
        let state = {"""
        
js_init_replacement = """        // State Management
        let sessionLogs = [];
        let state = {"""
        
content = content.replace(js_init_target, js_init_replacement)

js_logic_target = """        function switchPage(pageId, save = true) {"""
js_logic_replacement = """        /* --- THEME TOGGLE --- */
        function toggleTheme() {
            document.body.classList.toggle('light-mode');
            const isLight = document.body.classList.contains('light-mode');
            document.getElementById('themeToggle').textContent = isLight ? '🌙' : '☀️';
            localStorage.setItem('admin_ids_theme', isLight ? 'light' : 'dark');
        }

        /* --- LOGS --- */
        function addLog(actionName, count, outputText) {
            const entry = {
                time: new Date().toLocaleTimeString(),
                action: actionName,
                count: count,
                output: outputText
            };
            sessionLogs.unshift(entry);
            renderLogs();
        }

        function renderLogs() {
            const container = document.getElementById('logsContainer');
            if (sessionLogs.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 20px;">No logs yet. Process some IDs to see them here.</div>';
                return;
            }
            
            container.innerHTML = '';
            sessionLogs.forEach((log, index) => {
                const item = document.createElement('div');
                item.className = 'log-item';
                item.innerHTML = `
                    <div class="log-info">
                        <span class="log-time">${log.time}</span>
                        <span class="log-details">${log.action} (${log.count} IDs)</span>
                    </div>
                    <button class="btn btn-secondary" style="min-width: 80px; padding: 8px 16px;" onclick="copyLogData(${index}, this)">Copy</button>
                `;
                container.appendChild(item);
            });
        }
        
        function copyLogData(index, btnEl) {
            const text = sessionLogs[index].output;
            navigator.clipboard.writeText(text).then(() => {
                const originalText = btnEl.textContent;
                btnEl.textContent = '✅ Copied';
                btnEl.style.background = 'var(--success)';
                btnEl.style.color = 'white';
                setTimeout(() => {
                    btnEl.textContent = originalText;
                    btnEl.style.background = '';
                    btnEl.style.color = '';
                }, 2000);
            });
        }

        function switchPage(pageId, save = true) {"""
        
content = content.replace(js_logic_target, js_logic_replacement)


# 6. Apply Prefix/Suffix and Logs during riordinaID
riordina_target = """            const output = document.getElementById('output');
            output.textContent = outputText;"""
riordina_replacement = """            const prefix = document.getElementById('customPrefix').value.trim();
            const suffix = document.getElementById('customSuffix').value.trim();
            
            if (prefix || suffix) {
                const pre = prefix ? prefix + " " : "";
                const suf = suffix ? " " + suffix : "";
                outputText = finalList.map(id => `${pre}${id}${suf}`).join(separator);
            }

            const output = document.getElementById('output');
            output.textContent = outputText;
            addLog("Standard Processing", finalList.length, outputText);"""
            
content = content.replace(riordina_target, riordina_replacement)

# Apply logs to Level 30
level30_log_target = """            if (nuovi.length > 0) {
                saveLevel30History([...history, ...nuovi]);
                showToast(`Filtered ${nuovi.length} new IDs.`);
            } else {"""
            
level30_log_replacement = """            if (nuovi.length > 0) {
                saveLevel30History([...history, ...nuovi]);
                addLog("Level 30 Filter", nuovi.length, outputBox.textContent);
                showToast(`Filtered ${nuovi.length} new IDs.`);
            } else {"""
            
content = content.replace(level30_log_target, level30_log_replacement)


# 7. Button visual feedback for standard copy
copia_target = """        function copiaRisultato(elementId) {
            const text = document.getElementById(elementId).textContent.trim();
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied to clipboard!");
            });
        }"""
        
copia_replacement = """        function copiaRisultato(elementId) {
            const text = document.getElementById(elementId).textContent.trim();
            if (!text) return;
            
            const btn = event.currentTarget;
            const originalText = btn.innerHTML;
            
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied to clipboard!");
                btn.innerHTML = "Copied! ✅";
                btn.style.background = "var(--success)";
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = "";
                }, 2000);
            });
        }"""
        
content = content.replace(copia_target, copia_replacement)

# Same for copy quick command
copia_role_target = """        function copiaComandoRole() {
            navigator.clipboard.writeText("*role all -<@&951456227253170199>").then(() => {
                showToast("Command copied to clipboard!", "success");
            });
        }"""
        
copia_role_replacement = """        function copiaComandoRole() {
            const el = event.currentTarget;
            navigator.clipboard.writeText("*role all -<@&951456227253170199>").then(() => {
                showToast("Command copied to clipboard!", "success");
                el.style.background = 'rgba(46, 204, 113, 0.2)';
                el.style.borderColor = 'var(--success)';
                setTimeout(() => {
                    el.style.background = '';
                    el.style.borderColor = '';
                }, 2000);
            });
        }"""
        
content = content.replace(copia_role_target, copia_role_replacement)

# Nav Highlighting update
nav_highlight_target = """            // Highlight active nav item
            const items = document.querySelectorAll('.nav-item');
            if (pageId === 'standard') items[0].classList.add('active');
            if (pageId === 'level30') items[1].classList.add('active');
            if (pageId === 'settings') items[2].classList.add('active');"""

nav_highlight_replacement = """            // Highlight active nav item
            const items = document.querySelectorAll('.nav-item');
            if (pageId === 'standard') items[0].classList.add('active');
            if (pageId === 'level30') items[1].classList.add('active');
            if (pageId === 'logs') items[2].classList.add('active');
            if (pageId === 'settings') items[3].classList.add('active');"""
            
content = content.replace(nav_highlight_target, nav_highlight_replacement)

# Load theme on init
load_state_target = """        function loadState() {"""
load_state_replacement = """        function loadState() {
            if (localStorage.getItem('admin_ids_theme') === 'light') {
                toggleTheme();
            }"""
content = content.replace(load_state_target, load_state_replacement)


with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied.")
