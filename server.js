const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cors = require('cors');                    // 🔥 新增
const fetch = require('node-fetch');             // 🔥 新增
const FormData = require('form-data');           // 🔥 新增
const multer = require('multer');                // 🔥 新增

const app = express();
let port = 3001;

// 存儲活動的 Pikafish 會話
const activeSessions = new Map();

// 獲取資源路徑（開發和打包都適用）
function getResourcePath() {
    // 打包後 process.resourcesPath 指向 resources 目錄
    const resourcePath = process.resourcesPath || __dirname;
    return resourcePath;
}

// 添加請求日誌
app.use((req, res, next) => {
    console.log(`📥 收到請求: ${req.method} ${req.url}`);
    next();
});

// JSON 解析中間件
app.use(express.json());

// 🔥 新增：配置 multer（處理文件上傳）
const upload = multer({
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB 限制
});

// 🔥 新增：啟用 CORS（允許跨域請求）
app.use(cors());

// 🔥 新增：啟用 SharedArrayBuffer 支援（WASM 多執行緒需要）
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
});

// 提供靜態文件 - 使用資源路徑
const staticPath = getResourcePath();
app.use(express.static(staticPath));

// 主頁面路由
app.get('/', (req, res) => {
    try {
        const filePath = path.join(staticPath, 'chess1.html');
        console.log(`🏠 嘗試發送文件: ${filePath}`);

        if (fs.existsSync(filePath)) {
            console.log('✅ 找到 chess1.html，正在發送...');
            res.sendFile(filePath);
        } else {
            console.log('❌ chess1.html 不存在於:', filePath);
            res.status(404).json({
                error: 'chess1.html not found',
                searchPath: filePath,
                currentDir: staticPath,
                availableFiles: fs.readdirSync(staticPath)
            });
        }
    } catch (error) {
        console.error('❌ 主頁面錯誤:', error);
        res.status(500).json({ error: error.message });
    }
});

// 測試路由
app.get('/test', (req, res) => {
    try {
        const files = fs.readdirSync(staticPath);
        res.json({
            message: 'Server is working!',
            currentDir: staticPath,
            files: files,
            hasChess1: fs.existsSync(path.join(staticPath, 'chess1.html')),
            hasPikafish: fs.existsSync(path.join(staticPath, 'pikafish.exe'))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🔥 新增：皮卡魚圖片識別代理路由
app.post('/api/pikafish-recognize', upload.single('image'), async (req, res) => {
    console.log('\n========================================');
    console.log('🐟 收到皮卡魚識別請求');
    console.log('========================================');

    try {
        // 檢查是否有上傳圖片
        if (!req.file) {
            console.error('❌ 錯誤：沒有上傳圖片');
            return res.status(400).json({
                code: 400,
                msg: '沒有上傳圖片',
                data: null
            });
        }

        console.log('✅ 收到圖片:');
        console.log('   - 檔案名稱:', req.file.originalname || 'board.jpg');
        console.log('   - 檔案大小:', (req.file.size / 1024).toFixed(2), 'KB');
        console.log('   - 檔案類型:', req.file.mimetype);

        // 構建 FormData 準備轉發
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname || 'board.jpg',
            contentType: req.file.mimetype
        });

        // 轉發到皮卡魚 API
        console.log('\n📤 轉發到皮卡魚 API...');
        console.log('   - 目標: https://xiangqiai.com/api/board_recognition');

        const response = await fetch('https://xiangqiai.com/api/board_recognition', {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'origin': 'https://xiangqiai.com',
                'referer': 'https://xiangqiai.com/',
                ...formData.getHeaders()
            },
            body: formData
        });

        console.log('   - HTTP 狀態:', response.status, response.statusText);

        // 檢查 HTTP 狀態
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ 皮卡魚 API 錯誤:', errorText);
            return res.status(response.status).json({
                code: response.status,
                msg: `皮卡魚 API 錯誤: ${response.statusText}`,
                data: null
            });
        }

        // 解析回應
        const result = await response.json();
        console.log('\n✅ 皮卡魚回應:');
        console.log('   - 狀態碼:', result.code);
        console.log('   - 訊息:', result.msg);

        if (result.data) {
            console.log('   - FEN:', result.data.fen);
            console.log('   - 高信心度:', result.data.high_confidence);
            console.log('   - 方向:', result.data.orientation);
            console.log('   - 視角:', result.data.perspective);
        }
        console.log('========================================\n');

        // 返回給前端
        res.json(result);

    } catch (error) {
        console.error('❌ 代理錯誤:', error);
        res.status(500).json({
            code: 500,
            msg: `代理伺服器錯誤: ${error.message}`,
            data: null
        });
    }
});

// 🔥 新增：測試路由（檢查代理是否正常工作）
app.get('/api/pikafish-test', (req, res) => {
    res.json({
        status: 'OK',
        message: '皮卡魚代理路由正常運行',
        endpoint: 'POST /api/pikafish-recognize',
        method: 'multipart/form-data',
        field: 'image',
        maxFileSize: '10MB'
    });
});

// 初始化 Pikafish 引擎 API
app.post('/api/xiangqi/initialize', async (req, res) => {
    try {
        const { enginePath } = req.body;
        const sessionId = Date.now().toString();

        // 優先使用提供的引擎路徑，否則使用預設路徑
        let pikafishPath = enginePath;

        if (!pikafishPath) {
            const resourcePath = getResourcePath();
            pikafishPath = path.join(resourcePath, 'pikafish.exe');
        }

        console.log('🚀 初始化 Pikafish 引擎:', pikafishPath);

        // 檢查 pikafish.exe 是否存在
        if (!fs.existsSync(pikafishPath)) {
            throw new Error(`Pikafish 引擎不存在: ${pikafishPath}`);
        }

        // 啟動 Pikafish 進程
        const engineProcess = spawn(pikafishPath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: getResourcePath()
        });

        const session = {
            process: engineProcess,
            input: engineProcess.stdin,
            output: [],
            responseQueue: [],
            lastOutput: ''
        };

        // 監聽標準輸出
        engineProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                console.log('📥 Pikafish 輸出:', message);
                session.output.push(message);
                session.lastOutput = message;

                if (session.responseQueue.length > 0) {
                    const callback = session.responseQueue.shift();
                    callback(message);
                }
            }
        });

        // 監聽錯誤輸出
        engineProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message && !message.includes('pthread')) {
                console.log('🔍 Pikafish 調試:', message);
            }
        });

        // 監聽進程退出
        engineProcess.on('exit', (code) => {
            console.log(`🔚 Pikafish 進程退出，代碼: ${code}`);
            activeSessions.delete(sessionId);
        });

        // 監聽進程錯誤
        engineProcess.on('error', (error) => {
            console.error('❌ Pikafish 進程錯誤:', error);
            activeSessions.delete(sessionId);
        });

        // 保存會話
        activeSessions.set(sessionId, session);

        // 等待進程穩定啟動
        setTimeout(() => {
            if (activeSessions.has(sessionId)) {
                console.log('✅ Pikafish 會話創建成功:', sessionId);
                res.json({
                    success: true,
                    sessionId: sessionId,
                    message: 'Pikafish 引擎啟動成功',
                    enginePath: pikafishPath
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Pikafish 進程啟動後立即退出'
                });
            }
        }, 2000);

    } catch (error) {
        console.error('❌ 初始化 Pikafish 失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            currentDir: getResourcePath(),
            availableFiles: fs.readdirSync(getResourcePath())
        });
    }
});

// 發送命令到 Pikafish
app.post('/api/xiangqi/command', async (req, res) => {
    try {
        const { sessionId, command } = req.body;
        const session = activeSessions.get(sessionId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: '會話不存在',
                availableSessions: Array.from(activeSessions.keys())
            });
        }

        if (!session.process || session.process.killed) {
            activeSessions.delete(sessionId);
            return res.status(404).json({
                success: false,
                error: 'Pikafish 進程已終止'
            });
        }

        console.log(`📤 [${sessionId}] 發送命令:`, command);

        session.input.write(command + '\n');

        const timeout = setTimeout(() => {
            res.json({
                success: true,
                response: session.lastOutput || 'no response',
                command: command,
                recentOutput: session.output.slice(-3).join('\n')
            });
        }, 1000);

    } catch (error) {
        console.error('❌ 發送命令失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 清理 Pikafish 會話
app.post('/api/xiangqi/cleanup', (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = activeSessions.get(sessionId);

        if (session) {
            console.log('🔚 清理 Pikafish 會話:', sessionId);

            try {
                session.input.write('quit\n');
            } catch (e) {
                console.log('⚠️ 發送 quit 命令失敗，直接終止進程');
            }

            setTimeout(() => {
                if (session.process && !session.process.killed) {
                    session.process.kill('SIGTERM');
                }
            }, 1000);

            activeSessions.delete(sessionId);
        }

        res.json({ success: true, clearedSession: sessionId });
    } catch (error) {
        console.error('❌ 清理會話失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
    console.error('❌ 服務器錯誤:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// 啟動服務器 - 嘗試找到可用的埠
function startServer(attemptPort = 3001) {
    app.listen(attemptPort, () => {
        console.log(`🌐 象棋服務器啟動成功！`);
        console.log(`📁 服務器地址: http://localhost:${attemptPort}`);
        console.log(`🏠 象棋遊戲: http://localhost:${attemptPort}/chess1.html`);
        console.log(`🧪 測試頁面: http://localhost:${attemptPort}/test`);
        console.log(`🐟 皮卡魚測試: http://localhost:${attemptPort}/api/pikafish-test`); // 🔥 新增
        console.log(`📍 當前目錄: ${getResourcePath()}`);

        try {
            const files = fs.readdirSync(getResourcePath());
            console.log('\n📂 當前目錄文件:');
            files.forEach(file => {
                const filePath = path.join(getResourcePath(), file);
                const stats = fs.statSync(filePath);
                const icon = stats.isDirectory() ? '📁' : '📄';
                console.log(`  ${icon} ${file}`);
            });

            const chessFile = path.join(getResourcePath(), 'chess1.html');
            const engineFile = path.join(getResourcePath(), 'pikafish.exe');

            console.log('\n🔍 關鍵文件檢查:');
            console.log(`  📄 chess1.html: ${fs.existsSync(chessFile) ? '✅ 存在' : '❌ 缺失'}`);
            console.log(`  ⚙️ pikafish.exe: ${fs.existsSync(engineFile) ? '✅ 存在' : '❌ 缺失'}`);

            console.log('\n🎮 準備就緒！');

        } catch (error) {
            console.error('❌ 列出文件失敗:', error);
        }
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ 埠 ${attemptPort} 已被佔用，嘗試埠 ${attemptPort + 1}...`);
            startServer(attemptPort + 1);
        } else {
            console.error('❌ 服務器啟動失敗:', err);
            process.exit(1);
        }
    });
}

startServer(port);

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n🔚 正在關閉服務器...');

    activeSessions.forEach((session, sessionId) => {
        console.log(`🔚 關閉 Pikafish 會話: ${sessionId}`);
        try {
            if (session.input && !session.input.destroyed) {
                session.input.write('quit\n');
            }
            if (session.process && !session.process.killed) {
                session.process.kill('SIGTERM');
            }
        } catch (error) {
            console.log(`⚠️ 關閉會話 ${sessionId} 時出錯:`, error.message);
        }
    });

    setTimeout(() => {
        console.log('✅ 服務器已關閉');
        process.exit(0);
    }, 2000);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲異常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未處理的 Promise 拒絕:', reason);
});