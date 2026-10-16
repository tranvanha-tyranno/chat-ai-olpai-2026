# Qwen Chat Room

Trang chat với model OpenRouter và Groq tùy chọn.

Mở **Cài đặt** trên thanh trên để chọn model (nhà cung cấp, tên và số tham số). Danh sách chia nhóm **OpenRouter / Groq**; thanh trên, cột bên trái và từng phản hồi cũng ghi rõ nhà cung cấp. Lựa chọn tự động lưu trong localStorage và khôi phục khi mở lại app; mặc định dùng Qwen3 32B qua OpenRouter. Danh sách model và model mặc định nằm tại `public/config/models.js`, dùng chung cho trình duyệt và backend. Cùng một model ID ở hai nhà cung cấp vẫn là hai lựa chọn riêng.

Danh sách hiện có 32 lựa chọn OpenRouter và 1 lựa chọn Groq, đều nằm trong khoảng 30–500B tổng tham số. Có các model Qwen, Llama, Hermes, Mistral, Gemma, Nemotron, DeepSeek và GPT OSS, lớn nhất là Qwen3 Coder 480B. Với model MoE, `total` là tổng tham số và `active` là phần được kích hoạt mỗi lượt. Các ID cũ không còn trong danh mục và các model dưới 30B đã được bỏ. Danh mục nhà cung cấp có thể thay đổi; app vẫn kiểm tra trạng thái khi mở.

Ứng dụng đối chiếu danh mục model OpenRouter và đánh dấu **Không khả dụng** cho những ID không còn trong danh mục. Nếu model trả lỗi không có endpoint, tin nhắn đang gửi được giữ lại trong ô nhập và thông báo có nút **Đổi model**. Chọn model khác rồi gửi lại; app không tự chuyển model hay tự gửi thêm request. Khi không kiểm tra được danh mục, app vẫn cho thử các model đã cấu hình. Danh mục chỉ phản ánh trạng thái chung; quyền truy cập và thiết lập nhà cung cấp của từng tài khoản vẫn có thể ảnh hưởng đến request.

## Chạy local

1. Sao chép `.env.example` thành `.env` và điền key của nhà cung cấp muốn dùng:

   ```env
   OPENROUTER_API_KEY=sk-or-v1-...
   GROQ_API_KEY=gsk_...
   ```

2. Cài thư viện và chạy server (Node.js 20 trở lên):

   ```bash
   npm install
   npm start
   ```

3. Mở `http://localhost:8787`.

API key chỉ được đọc từ file `.env` ở backend, không nhúng vào JavaScript phía trình duyệt, localStorage hoặc lịch sử chat.

## API key

Chỉ sửa `OPENROUTER_API_KEY` và `GROQ_API_KEY` trong file `.env`. App tự đọc lại key khi đăng nhập, kiểm tra danh mục hoặc gửi tin nhắn, nên không cần khởi động lại khi chỉ đổi key. `.env.example` là mẫu và không chứa key thật.

Đã bỏ toàn bộ ô nhập/nút lưu/xóa/chọn nguồn key trên UI và API ghi key. File key từng lưu qua giao diện không được đọc nữa; key trong biến môi trường tiến trình cũng không thay thế key của file `.env`. Giữ cấu hình này đơn giản: chọn model trong Cài đặt, sửa key trong file.

Groq hiện có GPT OSS 120B phù hợp khoảng tham số đã chọn. Các model Groq 20B/27B và những ID ngừng phục vụ đã được bỏ. Xem [model Groq](https://console.groq.com/docs/models) và [danh mục OpenRouter](https://openrouter.ai/api/v1/models).

RPD/TPD phụ thuộc tài khoản và có thể thay đổi; các con số ước lượng trong bảng không được coi là quota cố định. Xem [hạn mức Groq](https://console.groq.com/docs/rate-limits) trong console của tài khoản. Ngân sách phiên của ứng dụng áp dụng cho cả hai nhà cung cấp và độc lập với quota Groq. Lỗi key, model ngừng phục vụ và quota giữ lại tin nhắn để sửa/gửi lại; không tự gửi request lần nữa.

## Hiển thị phản hồi và lịch sử

Phản hồi Markdown được hiển thị thành tiêu đề, danh sách, bảng, chữ đậm và khối code; HTML được lọc bằng DOMPurify. Khối code được tô màu cú pháp bằng Highlight.js, có nút **Copy code** giữ nguyên văn bản gốc; ngôn ngữ chưa hỗ trợ vẫn hiển thị được dạng văn bản. Mỗi phản hồi có **Copy phản hồi**. Thư viện được phục vụ tại máy chủ local, không tải từ CDN.

Trong lúc chờ model, thanh trạng thái hiển thị số giây đã chờ. Sau khi có kết quả, thời gian phản hồi được lưu cùng tin nhắn. Đây là thời gian chờ toàn bộ phản hồi, không phải thời gian suy nghĩ riêng của model. Nếu API trả phần tư duy hoặc tóm tắt giải thích, mở **Xem phần tư duy từ model** để xem; model không cung cấp thì mục này không xuất hiện. Khi hết giới hạn token, giao diện báo rõ phản hồi đã bị ngắt.

Bấm **×** cạnh một cuộc trò chuyện hoặc nút xóa trên thanh trên để xóa phiên. **Xóa tất cả** ở danh sách lịch sử hoặc **Xóa toàn bộ lịch sử** trong Cài đặt chỉ xóa lịch sử của mã ID đang đăng nhập. Ứng dụng yêu cầu xác nhận và chặn xóa khi phiên đang chờ phản hồi. Phần Bắt đầu nhanh và các thẻ gợi ý đã được bỏ.

## Giới hạn token

Mặc định mỗi session có ngân sách 3.000 token. Trong bảng **Ngân sách phiên**, sửa ô **Ngân sách phiên (token)** rồi bấm **Lưu** để tăng/giảm ngân sách từ 100 đến 1.000.000 token, nhưng không thấp hơn số đã dùng. Lựa chọn lưu cùng phiên và áp dụng làm mặc định cho phiên mới trên trình duyệt. Thay đổi không xóa lịch sử, không đặt lại bộ đếm và không thay đổi giới hạn model/nhà cung cấp. Các phiên cũ vẫn giữ ngân sách riêng. Khi đang chờ phản hồi, app chặn đổi ngân sách để bộ đếm nhất quán.

Khi bắt đầu gõ, bảng **Ngân sách phiên** tự hiện và ghim vào cột bên trái để theo dõi mà không che hội thoại. Bảng vẫn ở đó khi ngừng gõ, bấm sang chat hoặc gửi xong; bấm ×, nút Token hoặc Escape để đóng. Gõ tiếp sẽ mở lại. Nút **Token** trên thanh đầu trang vẫn cho phép rê chuột xem nhanh hoặc bấm để ghim. Trên điện thoại bảng nằm ở góc màn hình. Khi gõ, bảng cập nhật số ký tự, mức tăng/giảm token, token tin mới, token ngữ cảnh, tổng token gửi và ngân sách còn cho câu trả lời. Phần màu vàng trên thanh ngân sách là lượng token dự kiến gửi. Bộ đếm trước khi gửi dùng cùng phép ước tính với backend (khoảng 4 ký tự/token, cộng phần định dạng và tối đa 30 tin lịch sử); dấu `~` chỉ số ước tính, không phải kết quả tokenizer chính xác của từng model. Một ký tự không nhất thiết tương đương một token. Ứng dụng chặn gửi nếu tổng dự kiến không để lại ngân sách cho phản hồi.

Ô nhập mặc định gọn trong một dòng. Rê chuột, đặt con trỏ vào ô hoặc có bản nháp sẽ mở thêm phím tắt và số token gửi; bấm số token để mở bảng chi tiết. Bản nháp giữ ô nhập mở khi chuyển sang đọc chat. Sau khi gửi thành công, ô nhập trở về dạng gọn; lỗi gửi giữ lại nội dung để sửa. Phần chat và ô nhập có vùng riêng để tin nhắn không bị che.

Sau mỗi phản hồi, nhãn thời gian và số token **Gửi / Nhận / Tổng** được lưu cùng tin nhắn. Số thực ưu tiên dữ liệu `usage` từ API; trường còn thiếu được đánh dấu `~`. Token tư duy nằm trong token nhận và không cộng thêm vào tổng lần nữa.

## ID và lịch sử session

Đăng nhập bằng `Tyranno` hoặc `hoaibao` (không phân biệt chữ hoa/thường). Chọn session ở danh sách bên trái để xem và chat tiếp; trên điện thoại dùng danh sách chọn phía trên khung chat. Bấm **Cuộc trò chuyện mới** hoặc **Ctrl K** để tạo session riêng.

Mọi session được lưu ở `data/users.json`, nhóm theo mã ID, bao gồm ID session, tiêu đề, thời gian tạo/cập nhật, toàn bộ tin nhắn và số token. Dữ liệu vẫn còn sau khi đăng xuất, tải lại trang hoặc khởi động lại server. Khi nâng cấp từ định dạng cũ, lịch sử hiện có được chuyển thành session, kèm bản sao lưu `data/users.before-sessions.json`. Những lịch sử đã bị xóa trước khi nâng cấp không thể khôi phục từ dữ liệu hiện tại.

Cơ chế đăng nhập hiện dùng mã ID, ai biết mã có thể mở dữ liệu của mã đó. Lưu file phù hợp chạy local với một tiến trình server; khi triển khai cần ổ đĩa lưu bền vững hoặc chuyển sang database.

Chạy kiểm tra bằng `npm test`. Kiểm tra dùng dữ liệu tạm và phản hồi mô phỏng, không dùng key hoặc sửa dữ liệu thật. Repo phục vụ trực tiếp JavaScript thuần; `npm run build` kiểm tra cú pháp các module, không cần đóng gói.
