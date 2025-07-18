
## Tổng Quan Ứng Dụng Remote Desktop Sử Dụng WebRTC

Ứng dụng này cung cấp giải pháp điều khiển máy tính từ xa thông qua trình duyệt web, với khả năng truyền tải video, audio và nhận lệnh điều khiển (chuột, bàn phím) với độ trễ thấp. Hệ thống được xây dựng trên ba thành phần chính: Frontend (giao diện web), Electron Agent (ứng dụng máy tính từ xa), và Signaling Server (máy chủ trung gian).

### Mô Tả Chi Tiết Các Thành Phần

1. Frontend (Ứng dụng web trong trình duyệt)
**Mục đích**: Là giao diện người dùng để người điều khiển truy cập và tương tác với máy tính từ xa. 
**Công nghệ**: HTML, CSS, JavaScript (sử dụng WebRTC API). 
2. Electron Agent (Ứng dụng desktop trên máy tính từ xa)
**Mục đích**: Chạy trên máy tính mà bạn muốn điều khiển. Nó thu thập dữ liệu màn hình và âm thanh, đồng thời thực thi các lệnh điều khiển nhận được từ Frontend.  Công nghệ: Electron (Node.js), WebRTC API, robotjs.
3. Signaling Server (Máy chủ WebSocket) Mục đích: Đóng vai trò là trung gian để Frontend và Agent có thể "tìm thấy" và trao đổi thông tin ban đầu (các tin nhắn signaling) để thiết lập kết nối WebRTC trực tiếp. Công nghệ: Node.js, ws (WebSocket library).  

### Hướng Dẫn Cách Chạy Ứng Dụng
**Môi trường**:
 - Nodejs: v22.16.0
 - Visual C++ Build Tools bằng 2 cách	
	 - Cách 1: `npm install -g windows-build-tools`  	 	
	 - Cách 2 cài Visual  Studio https://visualstudio.microsoft.com/downloads/

  

Để toàn bộ hệ thống hoạt động, bạn cần chạy ba thành phần trên theo đúng thứ tự.  
1. Khởi Động Signaling Server
    Vào thư mục server:
    **Chạy lệnh:**
    Bash
	    ```bash
        npm install 
	    node signaling_server.js 
        ```

	Bạn sẽ thấy thông báo xác nhận rằng server đang lắng nghe trên cổng 7003 (ví dụ: Signaling Server running on ws://localhost:7003). 

2. Khởi Động Electron Agent 
	Vào thư mục electron-agent mở cmd
    **Chạy lệnh:**
	    Bash
	    ```bash
	    npm install 
	    npm start
        ```

	**Trường hợp lỗi:**
		Bash
	    ```bash
        npm install -g electron-rebuild
		electron-rebuild
		npm install
        ```

	Một cửa sổ ứng dụng Electron sẽ hiện ra. Kiểm tra console của terminal để xem các log trạng thái của Agent.
	 => Lưu ý vào file frontend.js tìm biến **signalingServerUrl** Cập nhật lại đúng địa chỉ signaling server mà bạn đã start trên 
 
3. Mở Frontend 
Vào thư mục frontend chạy file frontend.html
=> Lưu ý vào filemain.js tìm biến **signalingServerUrl** Cập nhật lại đúng địa chỉ signaling server mà bạn đã start trên 
 
### Luồng Chạy Ứng Dụng

Đây là tổng quan về luồng hoạt động từ khi khởi động đến khi điều khiển và truyền tải media. 
1. Luồng Khởi Động và Đăng Ký
	- Agent khởi chạy và kết nối tới Signaling Server.
	- Agent gửi: register (id: Agent_ID)
	- Signaling Server: Ghi nhận và lưu WebSocket của Agent.
	- Frontend được mở trong trình duyệt và kết nối tới Signaling Server.
	- Frontend gửi: register (id: Frontend_ID)
	- Signaling Server: Ghi nhận và lưu WebSocket của Frontend.
	- Frontend: Yêu cầu danh sách các Agent đang hoạt động từ Server và hiển thị cho người dùng.
2. Luồng Thiết Lập Kết Nối WebRTC (Signaling)
	Quá trình này diễn ra để hai bên (Frontend và Agent) có thể thiết lập một kênh giao tiếp trực tiếp.
	Frontend Gửi Yêu Cầu Kết Nối:
	- Frontend gửi: connect-request (to: Agent_ID, from: Frontend_ID) đến Signaling Server.
	Signaling Server: Chuyển tiếp connect-request từ Frontend đến Agent mục tiêu.
	- Agent Chuẩn Bị và Chấp Nhận Kết Nối:
	- Agent (Renderer Process) nhận connect-request (từ Main Process của chính nó). 
	- Khởi tạo RTCPeerConnection.
	- Tạo Data Channel (controlChannel) cho lệnh điều khiển.
	- Thu thập luồng video màn hình và luồng audio microphone.
	- Thêm các luồng này vào RTCPeerConnection.
	- Gửi: connect-request-accepted (to: Frontend_ID, from: Agent_ID) đến Signaling Server.
	- Tạo WebRTC Offer (SDP).
	- Gửi: offer (sdp: {...}, to: Frontend_ID, from: Agent_ID) đến Signaling Server.
	- Frontend Nhận Offer và Gửi Answer:
	- Frontend: Nhận connect-request-accepted từ Signaling Server.
	- Frontend: Khởi tạo RTCPeerConnection.
	- Frontend: Nhận offer từ Signaling Server. 
	- Thiết lập offer làm remoteDescription.
	- Lắng nghe ontrack để hiển thị video/audio.
	- Lắng nghe ondatachannel để nhận Data Channel.
	- Tạo WebRTC Answer (SDP).
	- Frontend gửi: answer (sdp: {...}, to: Agent_ID, from: Frontend_ID) đến Signaling Server.
	- Trao Đổi ICE Candidates:
	- Cả Frontend và Agent tạo ra các ICE Candidate (thông tin mạng để tìm đường đi trực tiếp).
	- Cả hai bên gửi: ice-candidate (candidate: {...}, to: ..., from: ...) qua Signaling Server để trao đổi với nhau.
	- Kết quả: Sau quá trình này, một kết nối WebRTC peer-to-peer trực tiếp được thiết lập.
3. Luồng Truyền Tải Media và Điều Khiển (Sau khi Kết nối WebRTC)
	Lúc này, dữ liệu được truyền trực tiếp giữa Frontend và Agent, không qua Signaling Server.
	Truyền tải Video & Audio:
	- Agent: Liên tục truyền luồng video màn hìn RTCPeerConnection đến Frontend.
	- Frontend: Nhận các luồng này và hiển thị video trên thẻ <video> 
	- Gửi Lệnh Điều Khiển:
	- Frontend: Khi người dùng tương tác (chuột, bàn phím) trên giao diện video:
	- Tạo lệnh điều khiển dưới dạng JSON (ví dụ: { type: 'mousemove', x: 0.5, y: 0.3 }).
	- Gửi: Lệnh này qua Data Channel (dataChannel.send()) đến Agent.
	- Agent (Renderer Process): Nhận lệnh qua dataChannel.onmessage.
	- Agent (Renderer Process) gửi: Lệnh này tới Agent (Main Process) (qua IPC).
	- Agent (Main Process): Sử dụng robotjs để thực thi hành động tương ứng trên máy tính. 


