# Qwen Chat Room

Trang chat tối giản dùng model `qwen/qwen3-32b` qua OpenRouter.

## Chạy local

1. Sao chép `.env.example` thành `.env` và thêm API key OpenRouter:

   ```env
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

2. Chạy server:

   ```bash
   npm start
   ```

3. Mở `http://localhost:8787`.

API key chỉ được đọc ở backend, không được đưa vào JavaScript phía trình duyệt.

## Giới hạn token

Mỗi `sessionId` có ngân sách tối đa 3.000 token. Backend tính phần token đầu vào, giới hạn `max_tokens` theo ngân sách còn lại, sau đó cập nhật bằng `usage.total_tokens` do OpenRouter trả về. Nút **Cuộc trò chuyện mới** tạo session mới và đặt lại bộ đếm. Bộ nhớ session hiện là in-memory, phù hợp cho chạy local hoặc một instance server.
