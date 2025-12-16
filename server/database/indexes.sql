-- Indexes for performance optimization
-- These indexes target frequently queried columns to improve lookup speed as the dataset grows.

-- Index on products(user_id) for faster retrieval of a user's products
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

-- Index on price_history(product_id) for faster retrieval of a product's price history
CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);

-- Index on price_history(recorded_at DESC) for faster sorting of price history (latest first)
CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at DESC);

-- Index on notifications(user_id, read) for faster retrieval of user's unread notifications
-- Note: Assuming table 'notifications' exists based on project documentation.
-- If it doesn't exist yet, this statement will fail.
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON notifications(user_id, read);
