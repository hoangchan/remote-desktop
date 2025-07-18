const { app, BrowserWindow, desktopCapturer, ipcMain, screen  } = require('electron');
const path = require('path');
const WebSocket = require('ws'); // For Signaling
const robot = require('robotjs'); // For controlling mouse/keyboard 


let mainWindow;
let ws; // WebSocket connection to Signaling Server
let agentId = 'Agent_Electron_A'; // ID của Agent này
let agentScreenWidth = 0; // Will store Agent's actual screen width
let agentScreenHeight = 0; // Will store Agent's actual screen height

//Phần này xử lý giao tiếp WebSocket với Signaling Server của bạn.
const signalingServerUrl = 'ws://localhost:7003';
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Quan trọng: Để Renderer có thể giao tiếp với Main Process
            nodeIntegration: false, // Tắt nodeIntegration để bảo mật hơn
            contextIsolation: true, // Bật contextIsolation
        }
    });

    mainWindow.loadFile('index.html');

    // Mở DevTools (để gỡ lỗi)
    // mainWindow.webContents.openDevTools();

    // Xử lý sự kiện khi cửa sổ đóng
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (ws) ws.close(); // Đóng WebSocket khi Agent đóng
    });
}

// Hàm xử lý sự kiện khi ứng dụng Electron sẵn sàng
app.whenReady().then(() => {
    createWindow();
	
    // Lấy kích thước màn hình chính để điều chỉnh tọa độ chuột
    const primaryDisplay = screen.getPrimaryDisplay();
    agentScreenWidth = primaryDisplay.size.width;
    agentScreenHeight = primaryDisplay.size.height;
	
    console.log(`Tien trinh chinh: Phat hien do phan giai man hinh Agent: ${agentScreenWidth}x${agentScreenHeight}`);


	
    // Bắt đầu kết nối tới Signaling Server
    connectToSignalingServer();
});

// Hàm xử lý sự kiện khi tất cả các cửa sổ đã đóng
app.on('window-all-closed', () => {
    // Trên macOS, các ứng dụng và thanh menu của chúng thường vẫn hoạt động cho đến khi người dùng thoát rõ ràng bằng Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Hàm xử lý sự kiện kích hoạt ứng dụng (ví dụ: nhấp vào biểu tượng dock trên macOS)
app.on('activate', () => {
    // Trên macOS, tạo lại cửa sổ trong ứng dụng khi biểu tượng dock được nhấp và không có cửa sổ nào khác đang mở
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Logic Signaling (Tiến trình chính)


function connectToSignalingServer() {
    ws = new WebSocket(signalingServerUrl);

    ws.onopen = () => {
        console.log('Main Process: Connected to Signaling Server');
        ws.send(JSON.stringify({ type: 'register', id: agentId }));
        // Báo cho Renderer biết đã kết nối
        if (mainWindow) {
            mainWindow.webContents.send('signaling-status', 'Connected to Signaling Server');
        }
    };

    ws.onmessage = message => {
        const data = JSON.parse(message.data);
        console.log('Main Process: Received signaling message:', data.type);

        // Chuyển tiếp tin nhắn signaling cho Renderer Process xử lý WebRTC
        if (mainWindow) {
            mainWindow.webContents.send('signaling-message', data);
        }
    };

    ws.onclose = () => {
        console.log('Main Process: Disconnected from Signaling Server');
        if (mainWindow) {
            mainWindow.webContents.send('signaling-status', 'Disconnected from Signaling Server');
        }
        // Thử kết nối lại sau 5 giây
        setTimeout(connectToSignalingServer, 5000); 
    };

    ws.onerror = error => {
        console.error('Main Process: Signaling WebSocket Error:', error);
        if (mainWindow) {
            mainWindow.webContents.send('signaling-status', 'Signaling Error');
        }
    };
}
 

// Đăng ký bộ xử lý IPC cho các nguồn desktopCapturer (được sử dụng bởi renderer.js)
ipcMain.handle('get-desktop-sources', async (event, options) => {
    // Tùy chọn có thể bao gồm { types: ['screen', 'window'], thumbnailSize: { width, height } }
    // Đặt thumbnailSize rất nhỏ hoặc 1x1 để tiết kiệm bộ nhớ
    const sources = await desktopCapturer.getSources({
        types: options.types || ['screen'], // Mặc định là 'screen' nếu không chỉ định
        thumbnailSize: options.thumbnailSize || { width: 1, height: 1 }
    });
    return sources;
}); 

// IPC: Nhận tin nhắn signaling WebRTC từ Renderer và gửi đến Signaling Server
ipcMain.on('send-signaling-message', (event, message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Thêm ID của Agent vào tin nhắn trước khi gửi đến Signaling Server
        ws.send(JSON.stringify({ ...message, from: agentId }));
    } else {
        console.warn('Tiến trình chính: WebSocket chưa mở để gửi tin nhắn signaling.');
    }
}); 

// IPC: Nhận lệnh điều khiển từ Renderer và thực thi bằng robotjs
ipcMain.on('control-command', (event, command) => {
    // console.log('Tiến trình chính: Đang thực thi lệnh điều khiển:', command.type); // Bỏ comment để xem log chi tiết
    try {
        switch (command.type) {
            case 'mousemove':
                // Chuyển đổi tọa độ đã chuẩn hóa (0-1) từ Frontend sang pixel thực tế của màn hình Agent
                const x = Math.round(command.x * agentScreenWidth);
                const y = Math.round(command.y * agentScreenHeight);
                robot.moveMouse(x, y);
                break;
            case 'mousedown':
                robot.mouseToggle('down', getMouseButton(command.button));
                break;
            case 'mouseup':
                robot.mouseToggle('up', getMouseButton(command.button));
                break;
            case 'mousewheel':
                // robotjs scrollMouse (deltaX, deltaY)
                // command.deltaY là lượng cuộn dọc từ Frontend
                // Bạn có thể cần điều chỉnh hệ số chia (ví dụ: 100) để điều chỉnh độ nhạy
                if (command.deltaY > 0) { // Cuộn xuống
                    robot.scrollMouse(0, -Math.abs(command.deltaY) / 100);
                } else if (command.deltaY < 0) { // Cuộn lên
                    robot.scrollMouse(0, Math.abs(command.deltaY) / 100);
                }
                break;
            case 'keydown':
                const keyName = getRobotjsKeyName(command.code);
                const modifiers = getRobotjsModifiers(command);
                if (keyName) {
                    robot.keyToggle(keyName, 'down', modifiers);
                } else {
                    console.warn(`Tiến trình chính: RobotJS không có ánh xạ trực tiếp cho keydown: ${command.code}`);
                    // Fallback: thử gõ ký tự nếu đó là một phím đơn giản
                    if (command.code.startsWith('Key') || command.code.startsWith('Digit') || command.code.startsWith('Numpad')) {
                         robot.keyToggle(command.code.replace('Key', '').replace('Digit', '').replace('Numpad', '').toLowerCase(), 'down', modifiers);
                    }
                }
                break;
            case 'keyup':
                const keyNameUp = getRobotjsKeyName(command.code);
                const modifiersUp = getRobotjsModifiers(command); // Modifiers có thể không cần thiết cho keyup
                if (keyNameUp) {
                    robot.keyToggle(keyNameUp, 'up', modifiersUp);
                } else {
                    console.warn(`Tiến trình chính: RobotJS không có ánh xạ trực tiếp cho keyup: ${command.code}`);
                     if (command.code.startsWith('Key') || command.code.startsWith('Digit') || command.code.startsWith('Numpad')) {
                         robot.keyToggle(command.code.replace('Key', '').replace('Digit', '').replace('Numpad', '').toLowerCase(), 'up', modifiersUp);
                    }
                }
                break;
            default:
                console.warn('Tiến trình chính: Lệnh điều khiển không được nhận dạng:', command.type);
        }
    } catch (error) {
        console.error('Tiến trình chính: Lỗi khi thực thi lệnh robotjs:', error, 'Dữ liệu lệnh:', command);
    }
});
/**
 * Ánh xạ số nút chuột của trình duyệt sang chuỗi nút của robotjs.
 * @param {number} button - Số nút chuột của trình duyệt (0: trái, 1: giữa, 2: phải).
 * @returns {string} Chuỗi nút của robotjs.
 */
 
function getMouseButton(button) {
    if (button === 0) return 'left';
    if (button === 1) return 'middle';
    if (button === 2) return 'right';
    return 'left'; // Mặc định là trái nếu không xác định
}

/**
 * Ánh xạ mã sự kiện bàn phím của trình duyệt sang tên phím của robotjs.
 * @param {string} code - KeyboardEvent.code (ví dụ: 'KeyA', 'Space', 'ArrowUp').
 * @returns {string|null} Tên phím của robotjs hoặc null nếu không thể ánh xạ trực tiếp.
 */
function getRobotjsKeyName(code) {
    // Tham khảo tên phím của RobotJS: [https://robotjs.io/docs/syntax#keyboard](https://robotjs.io/docs/syntax#keyboard)
    // Ánh xạ này cần đầy đủ để điều khiển bàn phím hoàn chỉnh.
    if (code.startsWith('Key')) return code.substring(3).toLowerCase(); // 'KeyA' -> 'a'
    if (code.startsWith('Digit')) return code.substring(5); // 'Digit1' -> '1'
    if (code.startsWith('Numpad')) return code.substring(6); // 'Numpad1' -> '1'

    switch (code) {
        case 'Space': return 'space';
        case 'Enter': return 'enter';
        case 'Tab': return 'tab';
        case 'Escape': return 'escape';
        case 'Backspace': return 'backspace';
        case 'Delete': return 'delete';
        case 'Home': return 'home';
        case 'End': return 'end';
        case 'PageUp': return 'pageup';
        case 'PageDown': return 'pagedown';
        case 'ArrowUp': return 'up';
        case 'ArrowDown': return 'down';
        case 'ArrowLeft': return 'left';
        case 'ArrowRight': return 'right';
        case 'F1': return 'f1';
        case 'F2': return 'f2';
        case 'F3': return 'f3';
        case 'F4': return 'f4';
        case 'F5': return 'f5';
        case 'F6': return 'f6';
        case 'F7': return 'f7';
        case 'F8': return 'f8';
        case 'F9': return 'f9';
        case 'F10': return 'f10';
        case 'F11': return 'f11';
        case 'F12': return 'f12';
        case 'PrintScreen': return 'printscreen';
        case 'ScrollLock': return 'scrolllock';
        case 'Pause': return 'pause';
        case 'Insert': return 'insert';
        case 'CapsLock': return 'capslock';
        case 'NumLock': return 'numlock';
        case 'ContextMenu': return 'menu'; // Phím menu ngữ cảnh chuột phải
        case 'MetaLeft': return 'command'; // Dành cho macOS (phím Command)
        case 'MetaRight': return 'command'; // Dành cho macOS (phím Command)
        // Thêm các phím đặc biệt khác nếu cần. Cẩn thận với các phím dành riêng cho hệ thống.
        default: return null;
    }
}

/**
 * Trích xuất các phím bổ trợ từ đối tượng lệnh cho robotjs.
 * @param {object} command - Đối tượng lệnh chứa các cờ boolean cho các phím bổ trợ.
 * @returns {string[]} Một mảng các chuỗi phím bổ trợ của robotjs.
 */
function getRobotjsModifiers(command) {
    const modifiers = [];
    if (command.ctrlKey) modifiers.push('control');
    if (command.shiftKey) modifiers.push('shift');
    if (command.altKey) modifiers.push('alt');
    // Lưu ý: Phím 'meta' thường là 'command' trên macOS và 'windows' trên Windows đối với robotjs
    // An toàn hơn nếu ánh xạ cụ thể nếu bạn muốn tính nhất quán đa nền tảng.
    // Hiện tại, giả sử 'meta' hoặc 'windows' được xử lý. 'meta' của RobotJS thường hoạt động cho cả hai.
    if (command.metaKey) {
        modifiers.push('meta'); // Cách tiếp cận phổ biến nhất
    }
    return modifiers;
}