// renderer.js (Chạy trong Renderer Process của Electron Agent)

let peerConnection;
let dataChannel; // Để gửi/nhận lệnh điều khiển
let currentStream; // Để giữ tham chiếu đến MediaStream từ desktopCapturer

const statusDisplay = document.getElementById('status-display');
const dataChannelDisplay = document.getElementById('data-channel');

function updateRendererStatus(message, color = 'black') {
    statusDisplay.textContent = message;
    statusDisplay.style.color = color;
    console.log(`[RENDERER STATUS] ${message}`);
}

function updateRendererStatusDataChannelDisplay(message, color = 'black') {
    dataChannelDisplay.textContent = message;
    dataChannelDisplay.style.color = color;
    console.log(`[RENDERER STATUS] ${message}`);
}
// Nhận trạng thái WebSocket từ Main Process
window.electronAPI.onSignalingStatus((status) => {
    updateRendererStatus(`Signaling: ${status}`);
});

// Cấu hình ICE Servers (phải khớp với Frontend)
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
}; 

// Hàm để lấy luồng màn hình bằng desktopCapturer
async function getScreenStreamElectron() {
    updateRendererStatus('Attempting to capture screen...', 'orange');
    try {
        console.log('Renderer: Calling desktopCapturer.getSources()');
        const sources = await window.electronAPI.getDesktopSources({});
        console.log('Renderer: desktopCapturer.getSources() returned:', sources.map(s => ({ id: s.id, name: s.name, display_id: s.display_id })));
        
        // --- CHỌN NGUỒN MÀN HÌNH ---
        // Lý tưởng nhất là cho người dùng chọn, nhưng để tự động:
        // Cố gắng tìm màn hình chính hoặc màn hình có tên thông dụng
        const screenSource = sources.find(source => source.id.startsWith('screen:'));
        // Nếu không tìm thấy, thử các tên phổ biến
        if (!screenSource) {
            screenSource = sources.find(source => 
                source.name === 'Entire Screen' || 
                source.name.toLowerCase().includes('screen') ||
                source.name.toLowerCase().includes('display')
            );
        }
		
		// Nếu vẫn không tìm thấy màn hình, lấy nguồn bất kỳ (có thể là một cửa sổ)
        if (!screenSource && sources.length > 0) {
            console.warn('Renderer: No specific screen source found, picking the first available source.');
            screenSource = sources[0];
        }
        if (!screenSource) {
            console.error('Renderer: No suitable screen source found from:', sources.map(s => s.name));
            updateRendererStatus('Error: No screen source found.', 'red');
            alert('Could not find a suitable screen to capture. Please check your display settings or try another source if available.');
            return null;
        }

        console.log('Renderer: Selected screen source:', screenSource.name, 'ID:', screenSource.id);

        // Lấy MediaStream từ nguồn đã chọn
        console.log('Renderer: Calling navigator.mediaDevices.getUserMedia()');
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false, // Tùy chọn: false nếu không cần âm thanh màn hình
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: screenSource.id,
                    // Điều chỉnh min/maxW/H để khớp với độ phân giải màn hình của bạn
                    minWidth: 1, // Đặt minWidth/minHeight nhỏ nhất để không bị lỗi nếu độ phân giải thấp
                    minHeight: 1,
                    maxWidth: 4096, // Đặt giá trị tối đa lớn để không giới hạn quá mức
                    maxHeight: 2160
                }
            }
        });
        if (!stream) {
            console.error('Renderer: getUserMedia returned a null stream.');
            updateRendererStatus('Error: getUserMedia returned null stream.', 'red');
            return null;
        }

        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length === 0) {
            console.error('Renderer: getUserMedia returned a stream but with no video tracks.');
            updateRendererStatus('Error: Stream has no video tracks.', 'red');
            // Log chi tiết các track nếu có để gỡ lỗi
            stream.getTracks().forEach(track => console.log(`  Track found: Kind=${track.kind}, Label=${track.label}, ID=${track.id}`));
            return null;
        }
		
        console.log('Renderer: Successfully captured screen stream!');
        updateRendererStatus('Screen captured successfully!', 'green');
		
        return stream;
    } catch (e) {
        console.error('Renderer: Error getting screen stream:', e);
        updateRendererStatus(`Failed to capture screen: ${e.message}`, 'red');
        return null;
    }
}


// Logic xử lý Signaling Message từ Main Process
window.electronAPI.onSignalingMessage(async (data) => {
    console.log('Renderer: Received signaling message from Main Process:', data.type);

    switch (data.type) {
        case 'connect-request':
            console.log('Renderer: Received connect-request from Frontend:', data.from);
            updateRendererStatus(`Connection request from ${data.from}. Preparing offer...`);

            // Đảm bảo PeerConnection được khởi tạo mới cho mỗi phiên
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            peerConnection = new RTCPeerConnection(iceServers);
            console.log('Renderer: PeerConnection initialized for connection with', data.from); // Added log

            // --- TẠO DATA CHANNEL --- 
            dataChannel = peerConnection.createDataChannel("controlChannel", {
                ordered: false,         // Không đảm bảo thứ tự gói tin (có thể giảm trễ)
                maxRetransmits: 0       // Không truyền lại gói tin bị mất (unreliable - độ trễ thấp nhất)
                // Hoặc maxPacketLifeTime: 50 // Giới hạn thời gian sống của gói tin (ví dụ 50ms)
            });

            // --- BƯỚC QUAN TRỌNG BẠN CẦN THÊM HOẶC SỬA ---
            // Gửi xác nhận lại cho Frontend rằng Agent đã chấp nhận yêu cầu
            // Đây là lúc Agent nói "OK, tôi đã sẵn sàng, hãy chuẩn bị cho Offer của tôi"
            window.electronAPI.sendSignalingMessage({
                type: 'connect-request-accepted',
                to: data.from, // Gửi lại cho Frontend đã yêu cầu 
            });
            console.log('Renderer: Sent connect-request-accepted to Frontend:', data.from);
            updateRendererStatus('Sent acceptance. Capturing screen and creating offer...');


            currentStream = await getScreenStreamElectron();

            if (currentStream && currentStream.getVideoTracks().length > 0) {
                currentStream.getTracks().forEach(track => {
                    console.log(`Renderer: Adding track kind: ${track.kind}, ID: ${track.id}, to PeerConnection.`);
                    peerConnection.addTrack(track, currentStream);
                });
                console.log('Renderer: All tracks from screen stream added to Peer Connection.');
            } else {
                console.error('Renderer: No valid video stream or tracks found from getScreenStreamElectron(). Cannot add track. ICE Candidates will be invalid.');
                updateRendererStatus('Failed to capture screen or no tracks found. Connection might fail.', 'red');
            }

            // Bắt sự kiện Data Channel 
            dataChannel.onopen = (event) => {
                console.log('Renderer: Agent Data Channel opened!');
                // Cập nhật trạng thái UI nếu cần
                updateRendererStatusDataChannelDisplay('Data Channel ready for commands.', 'purple');
            };

            dataChannel.onmessage = (event) => {
                // Nhận lệnh điều khiển từ Frontend (sau khi đã mở)
                try {
                    const command = JSON.parse(event.data);
                    console.log('Data Channel from Frontend:', command);
                    // Gửi lệnh này tới Main Process để robotjs xử lý
                    window.electronAPI.sendControlCommand(command);
                    console.log('Renderer: Received command from Frontend:', command.type);
                } catch (e) {
                    console.error('Renderer: Error parsing control command:', e);
                }
            };

            dataChannel.onclose = () => {
                console.log('Renderer: Agent Data Channel closed!');
                updateRendererStatusDataChannelDisplay('Data Channel closed.', 'gray');
            };

            dataChannel.onerror = (error) => {
                console.error('Renderer: Agent Data Channel Error:', error);
                updateAgentStatus(`Data Channel error: ${error.message}`, 'red');
            };


            // Xử lý ICE candidates 
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Renderer: Sending ICE Candidate with sdpMid:', event.candidate.sdpMid, 'sdpMLineIndex:', event.candidate.sdpMLineIndex);
                    window.electronAPI.sendSignalingMessage({
                        type: 'ice-candidate',
                        to: data.from,
                        candidate: JSON.stringify(event.candidate) // Candidate cần được stringify
                    });
                    console.log('Agent sending candidate:', JSON.stringify(event.candidate));
                    console.log('Sended: Sended ICE Candidate', event.candidate.sdpMid, 'sdpMLineIndex:', event.candidate.sdpMLineIndex);
                } else {
                    console.log('Renderer: ICE Candidate gathering finished.');
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                console.log('Renderer: ICE Connection State:', peerConnection.iceConnectionState);
                updateRendererStatus(`ICE Connection: ${peerConnection.iceConnectionState}`);
            };
            peerConnection.onconnectionstatechange = () => {
                console.log('Renderer: PeerConnection State:', peerConnection.connectionState);
                updateRendererStatus(`PeerConnection: ${peerConnection.connectionState}`);
            };


            try {
                // TẠO OFFER VÀ GỬI ĐI TỪ AGENT
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                console.log('Renderer: Local Description (Offer) set.');
                window.electronAPI.sendSignalingMessage({
                    type: 'offer',
                    to: data.from,
                    sdp: JSON.stringify(peerConnection.localDescription) // SDP cần được stringify
                });
                console.log('Agent sending offer:', JSON.stringify(peerConnection.localDescription));

                console.log('Renderer: Offer sent to Signaling Server.');
                updateRendererStatus('Offer sent. Waiting for Answer...');
            } catch (error) {
                console.error('Renderer: Error creating or sending Offer:', error);
                updateRendererStatus('Error creating/sending Offer', 'red');
            }
            break;

        case 'answer': 
            console.log('Renderer: Received WebRTC Answer from', data.from);
            updateRendererStatus('Received Answer. Establishing connection...');

            if (!peerConnection) {
                console.error("Renderer: PeerConnection not initialized when answer received!");
                updateRendererStatus('Error: PeerConnection not ready for Answer', 'red');
                return;
            }

            try {
                // Đảm bảo data.sdp là một đối tượng, nếu nó đã được stringify khi gửi.
                const sdpAnswer = typeof data.sdp === 'string' ? JSON.parse(data.sdp) : data.sdp;
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
                console.log('Renderer: Remote Description (Answer) set successfully.');
            } catch (error) {
                console.error('Renderer: Error setting remote description (Answer):', error);
                updateRendererStatus('Error setting Answer', 'red');
            }
            break;

        case 'ice-candidate': 
            console.log('Renderer: Received ICE Candidate from', data.from);
            if (peerConnection && data.candidate) {
                try {
                    // Đảm bảo data.candidate là một đối tượng, nếu nó đã được stringify khi gửi.
                    const iceCandidate = typeof data.candidate === 'string' ? JSON.parse(data.candidate) : data.candidate;
                    await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidate));
                    console.log('Renderer: Added ICE Candidate.');
                } catch (error) {
                    console.error('Renderer: Error adding received ICE candidate:', error);
                }
            }
            break;

        case 'error':
            console.error('Renderer: Signaling Server Error:', data.message);
            updateRendererStatus(`Signaling Error: ${data.message}`, 'red');
            break;
        default:
            console.warn('Renderer: Unhandled message type from Signaling Server:', data.type);
    }
});

// Khởi tạo Agent (hiển thị trạng thái ban đầu)
updateRendererStatus('Agent ready. Waiting for connection...');