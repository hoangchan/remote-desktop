// frontend.js (Frontend - JavaScript Logic)

let ws;
let peerConnection;
let dataChannel; // Biến toàn cục để xử lý Data Channel
let frontendId;
let pendingCandidates = []; // Mảng để lưu trữ ICE Candidates đang chờ

//Phần này xử lý giao tiếp WebSocket với Signaling Server của bạn.
const signalingServerUrl = 'ws://localhost:7003';

const statusDisplay = document.getElementById('status-display');
const frontendIdDisplay = document.getElementById('frontend-id-display');
const agentIdInput = document.getElementById('agentIdInput');
const connectButton = document.getElementById('connectButton'); 

const videoContainer = document.getElementById('videoContainer'); // Lấy container bao quanh video
const remoteVideo = document.getElementById('remoteVideo');
const fullscreenBtn = document.getElementById('fullscreenBtn');
// Lắng nghe sự kiện click vào nút fullscreen
fullscreenBtn.addEventListener('click', () => {
    // Kiểm tra xem trình duyệt có đang ở chế độ fullscreen không
    if (!document.fullscreenElement) {
        // Nếu không, yêu cầu videoContainer vào chế độ fullscreen
        // Bạn có thể request fullscreen cho remoteVideo trực tiếp hoặc cho videoContainer
        // Request cho container sẽ giúp các nút điều khiển (nếu có) cũng được fullscreen
        if (videoContainer.requestFullscreen) {
            videoContainer.requestFullscreen();
        } else if (videoContainer.mozRequestFullScreen) { // Firefox
            videoContainer.mozRequestFullScreen();
        } else if (videoContainer.webkitRequestFullscreen) { // Chrome, Safari, Opera
            videoContainer.webkitRequestFullscreen();
        } else if (videoContainer.msRequestFullscreen) { // IE/Edge
            videoContainer.msRequestFullscreen();
        }
        console.log('Frontend: Đã yêu cầu chế độ toàn màn hình.');
    } else {
        // Nếu đang ở chế độ fullscreen, thoát khỏi nó
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) { // Firefox
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) { // Chrome, Safari, Opera
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { // IE/Edge
            document.msExitFullscreen();
        }
        console.log('Frontend: Đã thoát chế độ toàn màn hình.');
    }
});

// Lắng nghe sự kiện thay đổi trạng thái fullscreen (ví dụ: người dùng thoát bằng Esc)
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        console.log('Frontend: Đang ở chế độ toàn màn hình.');
        // Bạn có thể thêm class CSS để thay đổi style video khi fullscreen
        remoteVideo.classList.add('fullscreen-active');
        // Cập nhật biểu tượng nút nếu có (ví dụ: chuyển từ maximize sang minimize icon)
    } else {
        console.log('Frontend: Đã thoát chế độ toàn màn hình.');
        remoteVideo.classList.remove('fullscreen-active');
        // Cập nhật biểu tượng nút
    }
});
// Hàm cập nhật trạng thái hiển thị trên giao diện
function updateStatus(message, color = 'black') {
    statusDisplay.textContent = message;
    statusDisplay.style.color = color;
    console.log(`[FRONTEND STATUS] ${message}`);
}

// Cấu hình ICE Servers (STUN/TURN)
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
    // Thêm TURN server nếu cần cho các môi trường mạng phức tạp hơn
    // { urls: 'turn:your.turn.server.com:xxxx', username: 'user', credential: 'password' }
};

// Hàm kết nối WebSocket tới Signaling Server
function connectWebSocket() {
    updateStatus('Đang kết nối tới Signaling Server...');
    ws = new WebSocket(signalingServerUrl); // Đảm bảo đúng địa chỉ IP và cổng của Signaling Server

    ws.onopen = () => {
        frontendId = 'Frontend_' + Math.random().toString(36).substring(2, 8); // Tạo ID ngẫu nhiên cho Frontend
        console.log('Frontend: Đã kết nối tới Signaling Server. ID của bạn:', frontendId);
        frontendIdDisplay.textContent = frontendId;
        updateStatus('Đã kết nối tới Signaling Server.');
        ws.send(JSON.stringify({ type: 'register', id: frontendId })); // Đăng ký ID với server
    };

    ws.onmessage = async message => {
        const data = JSON.parse(message.data);
        console.log('Frontend: Đã nhận loại tin nhắn signaling:', data.type);

        switch (data.type) {
            case 'agent-list':
                console.log('Frontend: Các Agent khả dụng:', data.agents);
                updateStatus(`Các Agent khả dụng: ${data.agents.join(', ')}`);
                break;

            case 'connect-request-accepted':
                console.log('Frontend: Agent đã chấp nhận yêu cầu kết nối. Đang khởi tạo PeerConnection...');
                updateStatus('Agent đã chấp nhận. Đang khởi tạo WebRTC...');
                
                // Đóng PeerConnection cũ nếu có để tránh lỗi
                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                }
                peerConnection = new RTCPeerConnection(iceServers);

                // Lắng nghe các track media (video/audio) đến từ Agent
                peerConnection.ontrack = (event) => {
                    console.log('Frontend: Đã nhận remote track:', event.track.kind);
                    if (event.track.kind === 'video') {
                        remoteVideo.srcObject = event.streams[0]; // Gán stream video vào thẻ <video>
                        updateStatus('Đã nhận luồng video!', 'green');
                    }
                };

                // Lắng nghe Data Channel từ Agent (vì Agent là bên tạo Data Channel trong trường hợp này)
                peerConnection.ondatachannel = (event) => {
                    dataChannel = event.channel;
                    dataChannel.onopen = () => console.log('Frontend: Data Channel đã mở!');
                    dataChannel.onclose = () => console.log('Frontend: Data Channel đã đóng!');
                    dataChannel.onerror = (error) => console.error('Frontend Data Channel Lỗi:', error);
                    // Frontend sẽ chỉ GỬI lệnh điều khiển, nên không cần lắng nghe onmessage ở đây.
                };

                // Xử lý ICE candidates (tìm kiếm cách kết nối tốt nhất)
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        console.log('Frontend: Đang gửi ICE Candidate tới Agent. sdpMid:', event.candidate.sdpMid, 'sdpMLineIndex:', event.candidate.sdpMLineIndex);
                        ws.send(JSON.stringify({
                            type: 'ice-candidate',
                            to: agentIdInput.value,
                            from: frontendId,
                            candidate: event.candidate
                        }));
                    }
                };

                // Theo dõi trạng thái kết nối ICE và PeerConnection
                peerConnection.oniceconnectionstatechange = () => {
                    console.log('Frontend: Trạng thái kết nối ICE:', peerConnection.iceConnectionState);
                    updateStatus(`Kết nối ICE: ${peerConnection.iceConnectionState}`);
                };
                peerConnection.onconnectionstatechange = () => {
                    console.log('Frontend: Trạng thái PeerConnection:', peerConnection.connectionState);
                    updateStatus(`PeerConnection: ${peerConnection.connectionState}`);
                };

                break;

            case 'offer': // Nhận Offer WebRTC từ Agent
                console.log('Frontend: Đã nhận Offer WebRTC từ ' + data.from);
                var dataSdp =JSON.parse (data.sdp);
                if (!data.sdp || dataSdp.type !== 'offer') {
                    console.error('Frontend: Đã nhận SDP Offer không hợp lệ:', data.sdp);
                    updateStatus('Lỗi: Đã nhận SDP Offer không hợp lệ', 'red');
                    return;
                }

                updateStatus('Đã nhận Offer WebRTC, đang gửi Answer...');
                
                if (!peerConnection) {
                    console.error("Frontend: PeerConnection chưa được khởi tạo khi nhận Offer!");
                    updateStatus('Lỗi: PeerConnection chưa sẵn sàng cho Offer', 'red');
                    return;
                }

                try {
                    // Thiết lập mô tả từ xa (Offer)
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(dataSdp));
                    console.log('Frontend: setRemoteDescription (Offer) thành công.');
                    updateStatus('Đã xử lý Offer. Đang tạo Answer...');

                    // Sau khi setRemoteDescription thành công, thêm các ICE Candidates đang chờ
                    while (pendingCandidates.length > 0) {
                        const candidate = pendingCandidates.shift(); // Lấy và xóa ứng cử viên đầu tiên
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate) ));
                            console.log('Frontend: Đã thêm ICE Candidate đang chờ thành công.');
                        } catch (e) {
                            console.error('Frontend: Lỗi khi thêm ICE candidate đang chờ:', e);
                        }
                    }

                    // Tạo và gửi Answer
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer); // Thiết lập mô tả cục bộ (Answer)
                    
                    ws.send(JSON.stringify({
                        type: 'answer',
                        to: data.from,
                        from: frontendId,
                        sdp: peerConnection.localDescription // Gửi Answer SDP
                    }));
                    updateStatus('Đã gửi Answer. Đang thiết lập kết nối ngang hàng...');
                } catch (error) {
                    console.error('Frontend: Lỗi khi xử lý Offer hoặc tạo Answer:', error);
                    updateStatus('Lỗi với WebRTC Offer/Answer', 'red');
                }
                break;

            case 'ice-candidate': // Nhận ICE Candidate từ Agent
                console.log('Frontend: Đã nhận ICE Candidate từ ' + data.from);
                
                if (data.candidate) { // Đảm bảo candidate không rỗng
                    if (peerConnection && peerConnection.remoteDescription) {
                        // Nếu remoteDescription đã có, thêm ngay lập tức
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(data.candidate) ));
                            console.log('Frontend: Đã thêm ICE Candidate thành công.');
                        } catch (error) {
                            console.error('Frontend: Lỗi khi thêm ICE candidate nhận được (trực tiếp):', error);
                        }
                    } else {
                        // Nếu remoteDescription chưa có, lưu vào mảng chờ
                        console.log('Frontend: Remote description chưa được thiết lập, đang đẩy ICE Candidate vào danh sách chờ.');
                        pendingCandidates.push(data.candidate);
                    }
                }
                break;

            case 'error':
                console.error('Frontend: Lỗi từ Signaling Server:', data.message);
                updateStatus(`Lỗi Signaling: ${data.message}`, 'red');
                break;

            default:
                console.warn('Frontend: Loại tin nhắn không được xử lý từ Signaling Server:', data.type);
        }
    };

    // Xử lý sự kiện đóng WebSocket
    ws.onclose = () => {
        console.log('Frontend: Đã ngắt kết nối khỏi Signaling Server');
        updateStatus('Đã ngắt kết nối khỏi Signaling Server.', 'gray');
        // Thử kết nối lại sau 5 giây
        setTimeout(connectWebSocket, 5000);
    };

    // Xử lý lỗi WebSocket
    ws.onerror = error => {
        console.error('Frontend: Lỗi WebSocket Signaling:', error);
        updateStatus('Lỗi Signaling!', 'red');
    };
}

// --- Xử lý sự kiện chuột và bàn phím ---

// Hàm tiện ích để gửi lệnh điều khiển qua Data Channel
function sendControlCommand(command) {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(command));
        // console.log('Frontend: Đã gửi lệnh điều khiển:', command.type); // Bỏ comment để xem log chi tiết
    } else {
        // console.warn('Frontend: Data Channel chưa mở. Không thể gửi lệnh:', command.type);
    }
}

// Throttling cho sự kiện mousemove để giảm tần suất gửi dữ liệu
let mouseMoveTimeout;
const MOUSE_MOVE_THROTTLE_MS = 50; // Gửi tối đa 1 lệnh mỗi 50ms để tối ưu hiệu suất

remoteVideo.addEventListener('mousemove', (e) => {
    // Xóa timeout trước đó để chỉ gửi lệnh sau khi chuột dừng di chuyển một chút (hoặc đạt ngưỡng thời gian)
    clearTimeout(mouseMoveTimeout);
    mouseMoveTimeout = setTimeout(() => {
        if (!dataChannel || dataChannel.readyState !== 'open') return;

        // Lấy kích thước và vị trí của thẻ video để tính toán tọa độ tương đối
        const rect = remoteVideo.getBoundingClientRect();
        // Chuyển đổi tọa độ pixel (clientX, clientY) thành tọa độ tỉ lệ (0-1)
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        sendControlCommand({ type: 'mousemove', x: x, y: y });
    }, MOUSE_MOVE_THROTTLE_MS);
});

remoteVideo.addEventListener('mousedown', (e) => {
    sendControlCommand({
        type: 'mousedown',
        button: e.button // 0: trái, 1: giữa, 2: phải
    });
});

remoteVideo.addEventListener('mouseup', (e) => {
    sendControlCommand({
        type: 'mouseup',
        button: e.button
    });
});

remoteVideo.addEventListener('wheel', (e) => {
    sendControlCommand({
        type: 'mousewheel',
        deltaY: e.deltaY // Giá trị cuộn dọc (dương khi cuộn xuống, âm khi cuộn lên)
    });
    e.preventDefault(); // Ngăn cuộn trang mặc định của trình duyệt khi cuộn chuột trên video
});

// Lắng nghe sự kiện bàn phím trên toàn bộ tài liệu
document.addEventListener('keydown', (e) => {
    // e.preventDefault(); // Cần cẩn thận khi bỏ comment này, có thể chặn các shortcut hữu ích của trình duyệt
    sendControlCommand({
        type: 'keydown',
        code: e.code,       // Ví dụ: 'KeyA', 'Space', 'ArrowUp'
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey  // Command trên macOS, phím Windows trên Windows
    });
});

document.addEventListener('keyup', (e) => {
    sendControlCommand({
        type: 'keyup',
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey
    });
});

// --- Khởi tạo ---
// Xử lý sự kiện nút "Kết nối đến Agent"
connectButton.addEventListener('click', () => {
    const targetAgentId = agentIdInput.value;
    if (ws && ws.readyState === WebSocket.OPEN && targetAgentId) {
        console.log('Frontend: Đang yêu cầu kết nối tới Agent:', targetAgentId);
        ws.send(JSON.stringify({
            type: 'connect-request',
            to: targetAgentId,
            from: frontendId
        }));
        updateStatus(`Đã yêu cầu kết nối tới ${targetAgentId}...`);
    } else {
        updateStatus('WebSocket chưa kết nối hoặc ID Agent trống.', 'red');
    }
});

// Khởi tạo kết nối WebSocket ngay khi trang tải xong
connectWebSocket();