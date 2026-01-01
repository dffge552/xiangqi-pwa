const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');

let mainWindow;
let pikafishProcess = null;
let pikafishReadline = null;
let serverProcess = null;  // 🔥 新增：伺服器進程

console.log('🚀 應用啟動中...');
console.log('📍 __dirname:', __dirname);
console.log('📍 app.isPackaged:', app.isPackaged);

// ==================== 獲取資源路徑 ====================
function getResourcePath(relativePath = '') {
    const isDev = !app.isPackaged;

    if (isDev) {
        return path.join(__dirname, relativePath);
    } else {
        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
        if (fs.existsSync(unpackedPath)) {
            return unpackedPath;
        }
        return path.join(__dirname, relativePath);
    }
}

// ==================== 🔥 新增：啟動內建伺服器 ====================
function startEmbeddedServer() {
    return new Promise((resolve, reject) => {
        const isDev = !app.isPackaged;

        // 尋找 server.js 路徑
        let serverPath;
        if (isDev) {
            serverPath = path.join(__dirname, 'server.js');
        } else {
            // 打包後可能在不同位置
            const paths = [
                path.join(__dirname, 'server.js'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js'),
                path.join(process.resourcesPath, 'server.js')
            ];

            for (const p of paths) {
                if (fs.existsSync(p)) {
                    serverPath = p;
                    break;
                }
            }
        }

        if (!serverPath || !fs.existsSync(serverPath)) {
            console.error('❌ 找不到 server.js');
            console.error('   搜尋路徑:');
            if (!isDev) {
                console.error('   -', path.join(__dirname, 'server.js'));
                console.error('   -', path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js'));
                console.error('   -', path.join(process.resourcesPath, 'server.js'));
            }
            reject(new Error('找不到 server.js'));
            return;
        }

        console.log('🌐 啟動內建伺服器:', serverPath);

        // 啟動 server.js
        serverProcess = spawn('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.dirname(serverPath),
            env: { ...process.env }
        });

        // 監聽伺服器輸出
        serverProcess.stdout.on('data', (data) => {
            const message = data.toString();
            console.log('🌐 [Server]', message.trim());
        });

        serverProcess.stderr.on('data', (data) => {
            const message = data.toString();
            if (!message.includes('ExperimentalWarning')) {
                console.error('🌐 [Server Error]', message.trim());
            }
        });

        serverProcess.on('error', (error) => {
            console.error('❌ 伺服器啟動失敗:', error);
            reject(error);
        });

        serverProcess.on('exit', (code, signal) => {
            console.log('🔚 伺服器退出，代碼:', code, '信號:', signal);
            serverProcess = null;
        });

        // 等待伺服器啟動完成
        setTimeout(() => {
            if (serverProcess && !serverProcess.killed) {
                console.log('✅ 內建伺服器已啟動 (localhost:3001)');
                resolve();
            } else {
                reject(new Error('伺服器啟動後立即退出'));
            }
        }, 3000);  // 給伺服器 3 秒啟動時間
    });
}

// ==================== Pikafish 引擎管理 ====================
function getPikafishPath() {
    const isDev = !app.isPackaged;

    if (isDev) {
        const paths = [
            path.join(__dirname, 'pikafish.exe'),
            path.join(__dirname, 'engines', 'pikafish.exe')
        ];

        for (const p of paths) {
            if (fs.existsSync(p)) {
                console.log('✅ 找到 Pikafish:', p);
                return p;
            }
        }
    } else {
        const paths = [
            path.join(process.resourcesPath, 'engines', 'pikafish.exe'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'pikafish.exe'),
            path.join(__dirname, 'pikafish.exe')
        ];

        for (const p of paths) {
            if (fs.existsSync(p)) {
                console.log('✅ 找到 Pikafish:', p);
                return p;
            }
        }
    }

    console.error('❌ 找不到 Pikafish 引擎');
    return null;
}

// ==================== IPC 處理器 ====================
ipcMain.handle('pikafish:start', async () => {
    try {
        if (pikafishProcess && !pikafishProcess.killed) {
            return { success: true, message: '引擎已在運行' };
        }

        const enginePath = getPikafishPath();
        if (!enginePath) {
            throw new Error('找不到 Pikafish 引擎文件');
        }

        console.log('🚀 啟動 Pikafish:', enginePath);

        pikafishProcess = spawn(enginePath, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        pikafishReadline = readline.createInterface({
            input: pikafishProcess.stdout
        });

        pikafishReadline.on('line', (line) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('pikafish:message', line);
            }
        });

        pikafishProcess.stderr.on('data', (data) => {
            console.log('Pikafish stderr:', data.toString());
        });

        pikafishProcess.on('exit', (code) => {
            console.log('Pikafish 退出,代碼:', code);
            pikafishProcess = null;
            pikafishReadline = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('pikafish:exit', code);
            }
        });

        pikafishProcess.on('error', (error) => {
            console.error('Pikafish 錯誤:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('pikafish:error', error.message);
            }
        });

        return { success: true, message: 'Pikafish 啟動成功' };

    } catch (error) {
        console.error('啟動失敗:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pikafish:send', async (event, command) => {
    try {
        if (!pikafishProcess || pikafishProcess.killed) {
            return { success: false, error: '引擎未運行' };
        }
        pikafishProcess.stdin.write(command + '\n');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pikafish:stop', async () => {
    if (pikafishProcess && !pikafishProcess.killed) {
        pikafishProcess.kill();
        pikafishProcess = null;
        pikafishReadline = null;
    }
    return { success: true };
});

// ==================== 窗口創建 ====================
async function createWindow() {
    console.log('\n' + '='.repeat(60));
    console.log('🪟 開始創建窗口');
    console.log('='.repeat(60));

    // 🔥 步驟 0：先啟動伺服器
    console.log('\n🌐 正在啟動內建伺服器...');
    try {
        await startEmbeddedServer();
        console.log('✅ 伺服器啟動成功，繼續創建窗口\n');
    } catch (error) {
        console.error('❌ 伺服器啟動失敗:', error.message);
        console.error('⚠️ 皮卡魚線上識別功能將無法使用');
        console.error('⚠️ 但應用程式仍會繼續啟動\n');
        // 繼續執行，讓用戶知道問題
    }

    // 🔥 步驟 1：確認 preload.js 路徑
    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('📂 Preload 文件檢查:');
    console.log('   絕對路徑:', preloadPath);
    console.log('   文件存在:', fs.existsSync(preloadPath));

    if (!fs.existsSync(preloadPath)) {
        console.error('❌ 致命錯誤: preload.js 不存在！');
        console.error('   目錄內容:', fs.readdirSync(__dirname).filter(f => f.endsWith('.js')));
        app.quit();
        return;
    }

    // 🔥 步驟 2：讀取 preload.js 內容驗證
    try {
        const preloadContent = fs.readFileSync(preloadPath, 'utf8');
        const hasContextBridge = preloadContent.includes('contextBridge');
        const hasExposeInMainWorld = preloadContent.includes('exposeInMainWorld');

        console.log('   包含 contextBridge:', hasContextBridge ? '✅' : '❌');
        console.log('   包含 exposeInMainWorld:', hasExposeInMainWorld ? '✅' : '❌');

        if (!hasContextBridge || !hasExposeInMainWorld) {
            console.error('❌ preload.js 內容不完整！');
        }
    } catch (err) {
        console.error('❌ 無法讀取 preload.js:', err.message);
    }

    // 🔥 步驟 3：創建窗口配置
    console.log('\n🔧 創建 BrowserWindow...');
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            // 🔥 關鍵配置
            nodeIntegration: false,        // 禁用 Node.js 集成
            contextIsolation: true,        // 啟用上下文隔離
            preload: preloadPath,          // preload 腳本路徑
            sandbox: false,                // 關閉沙箱（允許 IPC）
            webSecurity: true,             // 保持 Web 安全
            enableRemoteModule: false      // 禁用 remote 模組
        }
    });

    console.log('✅ BrowserWindow 已創建');
    console.log('   配置:');
    console.log('   - nodeIntegration: false');
    console.log('   - contextIsolation: true');
    console.log('   - preload:', preloadPath);

    // 🔥 步驟 4：載入頁面
    const chessPath = getResourcePath('chess1.html');

    if (!fs.existsSync(chessPath)) {
        console.error('❌ chess1.html 不存在:', chessPath);
        app.quit();
        return;
    }

    console.log('\n📄 載入頁面:', chessPath);

    try {
        await mainWindow.loadFile(chessPath);
        console.log('✅ 頁面載入成功');
    } catch (err) {
        console.error('❌ 頁面載入失敗:', err);
        app.quit();
        return;
    }

    // 🔥 步驟 5：頁面載入完成後驗證 API
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('\n📄 頁面載入完成事件觸發');

        // 等待 1 秒後檢查 API
        setTimeout(() => {
            console.log('🔍 開始驗證 API 注入...');

            mainWindow.webContents.executeJavaScript(`
                (function() {
                    console.log('\\n' + '='.repeat(60));
                    console.log('🔍 API 注入驗證 (from main.js)');
                    console.log('='.repeat(60));
                    
                    const results = {
                        pikafish: typeof window.pikafish,
                        appPath: typeof window.appPath,
                        electronEnv: typeof window.electronEnv
                    };
                    
                    console.log('window.pikafish:', results.pikafish);
                    console.log('window.appPath:', results.appPath);
                    console.log('window.electronEnv:', results.electronEnv);
                    
                    if (results.pikafish !== 'undefined') {
                        console.log('✅ window.pikafish 已注入');
                        console.log('   方法:', Object.keys(window.pikafish));
                    } else {
                        console.error('❌ window.pikafish 未注入！');
                    }
                    
                    console.log('='.repeat(60) + '\\n');
                    
                    return results;
                })()
            `).then(results => {
                console.log('📊 API 注入結果:', results);

                if (results.pikafish === 'undefined') {
                    console.error('\n❌❌❌ 嚴重錯誤：API 未注入 ❌❌❌');
                    console.error('可能原因:');
                    console.error('1. preload.js 沒有執行');
                    console.error('2. contextBridge 調用失敗');
                    console.error('3. 安全策略阻止了注入');
                } else {
                    console.log('\n✅✅✅ API 注入成功！✅✅✅');
                }
            }).catch(err => {
                console.error('❌ 執行驗證腳本失敗:', err);
            });
        }, 1000);
    });

    // 監聽頁面錯誤
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('❌ 頁面載入失敗:');
        console.error('   錯誤代碼:', errorCode);
        console.error('   錯誤描述:', errorDescription);
    });

    mainWindow.on('closed', () => {
        console.log('🔒 窗口已關閉');
        mainWindow = null;
    });

    console.log('='.repeat(60));
    console.log('✅ createWindow 完成\n');
}

// ==================== App 事件 ====================
app.on('ready', () => {
    console.log('✅ App ready 事件觸發');
    createWindow();
});

app.on('window-all-closed', () => {
    console.log('🚪 所有窗口已關閉');

    // 🔥 關閉 Pikafish 引擎
    if (pikafishProcess && !pikafishProcess.killed) {
        console.log('🔚 關閉 Pikafish 引擎');
        pikafishProcess.kill();
    }

    // 🔥 關閉伺服器
    if (serverProcess && !serverProcess.killed) {
        console.log('🔚 關閉內建伺服器');
        serverProcess.kill();
    }

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('will-quit', () => {
    console.log('🔚 應用程式即將退出');

    // 🔥 清理 Pikafish
    if (pikafishProcess && !pikafishProcess.killed) {
        console.log('🔚 清理 Pikafish 進程');
        try {
            pikafishProcess.kill('SIGTERM');
        } catch (e) {
            console.error('清理 Pikafish 失敗:', e.message);
        }
    }

    // 🔥 清理伺服器
    if (serverProcess && !serverProcess.killed) {
        console.log('🔚 清理伺服器進程');
        try {
            serverProcess.kill('SIGTERM');
        } catch (e) {
            console.error('清理伺服器失敗:', e.message);
        }
    }
});

// ==================== 錯誤捕獲 ====================
process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲異常:', error);
    console.error('堆疊:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未處理的 Promise 拒絕:', reason);
});