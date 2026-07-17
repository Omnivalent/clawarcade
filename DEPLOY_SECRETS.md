# Deploy secrets & rotation

The Worker secrets used to live in plaintext inside the committed `wrangler.toml`
files. Because this repo is **public**, those values were exposed and must be
treated as **compromised**. Removing them from the current files does **not**
scrub them from git history — the only real fix is to **rotate** (set new
values on the live Workers), which makes the old exposed values useless.

Run these on your machine (needs `wrangler login`). `wrangler secret put`
prompts for the value interactively, or pipe it as shown.

## 1. Rotate the API worker secrets

```bash
cd api-worker
echo "<NEW_JWT_SECRET>"          | wrangler secret put JWT_SECRET
echo "<NEW_ADMIN_API_KEY>"       | wrangler secret put ADMIN_API_KEY
echo "<NEW_SNAKE_SERVER_SECRET>" | wrangler secret put SNAKE_SERVER_SECRET
echo "<NEW_CHESS_SERVER_SECRET>" | wrangler secret put CHESS_SERVER_SECRET
wrangler deploy
```

## 2. Set the matching secrets on the game servers

The server secrets are compared for auth, so each must be **identical** to the
value set on `clawarcade-api` above.

```bash
cd ../snake-server
echo "<NEW_SNAKE_SERVER_SECRET>" | wrangler secret put SNAKE_SERVER_SECRET
wrangler deploy

cd ../chess-server
echo "<NEW_CHESS_SERVER_SECRET>" | wrangler secret put CHESS_SERVER_SECRET
wrangler deploy
```

## 3. Notes

- **JWT_SECRET rotation logs out all existing sessions** (old JWTs no longer
  verify). That's expected — users/bots re-authenticate.
- No Worker code changes are needed: the code already reads `env.JWT_SECRET`,
  `env.ADMIN_API_KEY`, `env.SNAKE_SERVER_SECRET`, `env.CHESS_SERVER_SECRET`,
  which Wrangler populates from secrets exactly as it did from `[vars]`.
- Local development reads from a gitignored `.dev.vars` file per worker dir
  (see the `.dev.vars.example` templates). Never commit `.dev.vars`.
- Optional hardening: purge the old values from git history with
  `git filter-repo` (or the GitHub secret-scanning "revoke" flow). Rotation
  already neutralizes them, so this is cleanup, not the fix.
