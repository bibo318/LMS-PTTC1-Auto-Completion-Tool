# LMS-PTTC1 Auto Completion Tool (v7)

Dán nội dung file `/home/runner/work/LMS-PTTC1---Auto-Completion-Tool-/LMS-PTTC1---Auto-Completion-Tool-/lms-pttc1-auto-completion-v7.js` vào Console (F12) ở bất kỳ trang `lms.pttc1.edu.vn`.

## Tính năng v7

- ⏭️ **Course-skip**: bỏ qua môn nếu progress = 100% hoặc toàn bộ activity đã hoàn thành.
- 🔄 **Resume** (từ v6): tự bỏ qua activity đã done (`data-completionstate`) và chạy tiếp phần còn dở.
- 📝 **Forum copy** (từ v6): lưu và điền lại **subject + body** từ bài gần nhất.
- 🎯 **Quiz smart** (từ v6): submit blank để lấy review, đọc đáp án đúng, re-attempt nếu có thể.
- ✅ Tương thích xử lý activity cơ bản: `videotime`, `resource`, `folder`, `page`, `url`, `book`.

## Ghi chú

- Script chạy theo heuristic của Moodle/LMS PTTC1 nên có thể khác nhẹ theo từng course/theme.
- Nếu LMS yêu cầu xác nhận popup khi nộp quiz/forum, bạn cần bấm xác nhận thủ công.
