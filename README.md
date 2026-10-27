# ScholarSpace local authentication

## Start the application

Use Node.js 22.13 or newer (Node.js 24 is recommended). From this folder, run:

```powershell
node server.js
```

Then open <http://127.0.0.1:3000>. Do not open `index.html` directly as a file; authentication requires the server.

The first account can be created from **Sign in → Create an account**. Passwords must be at least 12 characters. Accounts and hashed passwords are stored in `data/users.sqlite`; session tokens are stored as SHA-256 hashes and issued to the browser in an HttpOnly, SameSite cookie. The `data/` folder is excluded from version control.

## Configuration

- `PORT` changes the default port (`3000`).
- `HOST` changes the bind address (defaults to `127.0.0.1`).
- `DATABASE_PATH` changes the SQLite file path.
- If running behind a trusted HTTPS reverse proxy, set `TRUST_PROXY=1` and ensure the proxy sets `X-Forwarded-Proto` and the original `Host` header.

For remote deployment, use HTTPS, set `NODE_ENV=production` so cookies receive the `Secure` attribute, and store the database on persistent storage. Do not expose the development server directly to the public internet without a production deployment setup.

Sign-in verifies accounts but does not yet synchronize or protect research projects: project content continues to be stored in browser local storage. The SQLite database currently stores accounts and sessions only.
