-- One-time password deadline (REWRITE_PLAN.md §5.2).
--
-- Admin-issued temporary passwords previously lived forever: an account created months
-- ago still accepted its initial "Tmp!xxxx" until someone happened to use it. This
-- column stamps a deadline on such credentials so an unused one stops working on its
-- own. NULL means the password is a normal, non-expiring one chosen by the user.

ALTER TABLE users ADD COLUMN password_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
