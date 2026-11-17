-- Thành viên: khoá tài khoản và bắt đổi mật khẩu tạm ở lần đăng nhập đầu.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN created_by INTEGER;
