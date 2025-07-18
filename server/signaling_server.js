// signaling_server.js (Phiên bản đã cập nhật)

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 7003 }); // Đảm bảo khớp với port bạn muốn

const clients = new Map(); // Lưu trữ kết nối của Agent và Frontend theo ID
                           // Key: Client ID (e.g., 'Agent_A', 'Frontend_User_Browser')
                           // Value: WebSocket object

wss.on('connection', ws => {
    console.log('Signaling Server: New client connected. Total clients:', wss.clients.size);

    // Khi một client kết nối, chúng ta cần biết ID của nó
    // ID sẽ được gửi trong thông điệp đầu tiên (register từ Agent, hoặc request-agent từ Frontend)
    let clientId = 'unknown'; 

    ws.on('message', message => {
        const data = JSON.parse(message);
        console.log(`Signaling Server: Received [${data.type}] from client with ID ${data.from || clientId} to ${data.to || 'server'}`); // Log chi tiết

        // Cập nhật clientId cho kết nối hiện tại nếu là thông điệp 'register' hoặc 'request-agent'
        if (data.type === 'register' || data.type === 'request-agent') {
            clientId = data.id || data.from; // Lấy ID từ 'id' (register) hoặc 'from' (request-agent)
            clients.set(clientId, ws);
            console.log(`Signaling Server: Client ${clientId} registered. Current active clients: [${Array.from(clients.keys()).join(', ')}]`);
        }

        switch (data.type) {
            case 'register': // Agent đăng ký ID của nó
                // Logic đã được xử lý ở trên (clientId và clients.set)
                break;

            case 'connect-request': // Frontend yêu cầu kết nối với một Agent cụ thể
                const targetAgentId = data.to;
                const frontendId = data.from; // ID của Frontend gửi yêu cầu

                const targetAgentWs = clients.get(targetAgentId);
                if (targetAgentWs) {
                    console.log(`Signaling Server: Forwarding 'connect-request' from Frontend [${frontendId}] to Agent [${targetAgentId}]`);
                    // Gửi thông điệp tới Agent, báo hiệu có Frontend muốn kết nối
                    targetAgentWs.send(JSON.stringify({
                        type: 'connect-request',
                        from: frontendId // Gửi ID của Frontend cho Agent biết ai đang yêu cầu
                    }));
                } else {
                    console.warn(`Signaling Server: Agent [${targetAgentId}] not found for request from [${frontendId}]. Sending error back to Frontend.`);
                    // Gửi lỗi về cho Frontend nếu Agent không tồn tại/chưa online
                    ws.send(JSON.stringify({ type: 'error', message: `Agent ${targetAgentId} not found or offline.`, targetId: targetAgentId }));
                }
                break;
            case 'connect-request-accepted': // Agent gửi về Frontend để xác nhận đã chấp nhận
                const acceptedToId = data.to;
                const acceptedFromId = data.from || clientId;
                const acceptedReceiverWs = clients.get(acceptedToId);

                if (acceptedReceiverWs) {
                    console.log(`Signaling Server: Forwarding 'connect-request-accepted' from Agent [${acceptedFromId}] to Frontend [${acceptedToId}]`);
                    acceptedReceiverWs.send(JSON.stringify({ ...data, from: acceptedFromId }));
                } else {
                    console.warn(`Signaling Server: Receiver [${acceptedToId}] not found for 'connect-request-accepted' from [${acceptedFromId}].`);
                }
                break;

            case 'offer': // Offer từ Agent (gửi tới Frontend)
            case 'answer': // Answer từ Frontend (gửi tới Agent)
            case 'ice-candidate': // ICE Candidate từ cả hai bên
                // Chuyển tiếp tín hiệu từ người gửi tới người nhận
                const receiverId = data.to;
                const senderId = data.from || clientId; // Đảm bảo luôn có ID người gửi
                const receiverWs = clients.get(receiverId);

                if (receiverWs) {
                    console.log(`Signaling Server: Forwarding [${data.type}] from [${senderId}] to [${receiverId}] with sdpMid: ${data.candidate ? data.candidate.sdpMid : 'N/A'}`);
                    // Gắn thêm 'from' để người nhận biết ai gửi
					console.log(data.type);
					console.log('Signaling Server: Data being forwarded (candidate):', data);
             
                    receiverWs.send(JSON.stringify({ ...data, from: senderId })); 
				   } else {
                    console.warn(`Signaling Server: Receiver [${receiverId}] not found for message type [${data.type}] from [${senderId}].`);
                    // Tùy chọn: Gửi lỗi về cho người gửi nếu người nhận không online
                    // ws.send(JSON.stringify({ type: 'error', message: `Recipient ${receiverId} not found for ${data.type}`, targetId: receiverId }));
                }
                break;

            default:
                console.warn(`Signaling Server: Unhandled message type [${data.type}] from [${clientId}]`);
        }
    });

    ws.on('close', () => {
        // Xóa client khỏi map khi ngắt kết nối
        for (let [id, clientWs] of clients.entries()) {
            if (clientWs === ws) {
                clients.delete(id);
                console.log(`Signaling Server: Client ${id} disconnected. Remaining clients: [${Array.from(clients.keys()).join(', ')}]`);
                break;
            }
        }
        if (clientId === 'unknown') {
             console.log('Signaling Server: Unknown client disconnected.');
        }
    });

    ws.on('error', error => console.error('Signaling Server Error:', error));
});

console.log('Signaling Server running on ws://localhost:7003');