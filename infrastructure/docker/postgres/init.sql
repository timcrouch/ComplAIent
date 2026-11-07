-- Runs once, as the superuser, on first start (docker-entrypoint-initdb.d).
-- Passwords come from the container environment via psql \getenv.
\set ON_ERROR_STOP on
\getenv owner_password ISMS_OWNER_PASSWORD
\getenv app_password ISMS_APP_PASSWORD

CREATE ROLE isms_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE isms_app LOGIN PASSWORD :'app_password';

CREATE DATABASE isms OWNER isms_owner;
CREATE DATABASE isms_test OWNER isms_owner;

REVOKE CONNECT ON DATABASE isms, isms_test FROM PUBLIC;
GRANT CONNECT ON DATABASE isms TO isms_app;
GRANT CONNECT ON DATABASE isms_test TO isms_app;

-- isms_owner is not a superuser, so the extension is created here.
\connect isms
CREATE EXTENSION IF NOT EXISTS vector;
\connect isms_test
CREATE EXTENSION IF NOT EXISTS vector;
