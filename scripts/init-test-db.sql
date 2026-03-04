-- Auto-creates the test database when the PostgreSQL container starts for the first time.
-- Mounted via docker-compose.yml → /docker-entrypoint-initdb.d/
SELECT 'CREATE DATABASE stellar_trader_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'stellar_trader_test')\gexec
