# Worker API setup

This Worker is the API runtime for the independent Qingtian Pay project.

## Required production resources

- Create a **new** D1 database named `qingtianpay-db`. Never bind the legacy `qingtian-pay-auth` database.
- Replace `database_id` in `wrangler.toml` with the new database UUID.
- Set Worker secret `BOOTSTRAP_SECRET` to a long random value before the first deployment.
- Set `ADMIN_ORIGIN` to the exact production admin origin when the admin frontend is moved to its final domain.
- Configure Alipay application credentials as Worker secrets in a later payment-channel release; never commit private keys or certificates.

## Initial setup

1. Apply migrations in order to the new D1 database only.
2. Deploy the Worker.
3. Send one authenticated bootstrap request to `POST /api/auth/bootstrap` with header `X-Bootstrap-Secret` and JSON body `{"password":"<new password>" }`. The password must be at least 12 characters. This initializes the three protected super-admin accounts with one password and permanently closes bootstrap.
4. Remove/rotate the bootstrap secret after initialization.
5. Verify `GET /api/health`, login, logout, and session expiry.

Passwords are stored as PBKDF2-HMAC-SHA-256 hashes using 310,000 iterations and a random salt. Session tokens are random, stored only as SHA-256 hashes, and delivered using Secure, HttpOnly, SameSite=Strict cookies.

The API currently includes health, protected-superadmin bootstrap, login/logout/session introspection, site creation/listing, product creation/listing, order listing, and administrator listing. Alipay signing/notification/refund and delivery execution are not yet implemented; those routes must not be presented as production-ready until their integration and end-to-end tests are complete.
