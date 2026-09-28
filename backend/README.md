# Backend

## Local mode (default, no AWS)

```bash
npm install
npm run start    # http://0.0.0.0:3100
npm run dev      # watch reload
```

See [`../docs/LOCAL_DEV.md`](../docs/LOCAL_DEV.md).

- Entry: `src/local/server.ts`
- Rooms: file-backed under `data/` (gitignored)
- Campaign: `../content/campaigns/luppolandia-brew/`

## AWS mode (later)

API Gateway WebSockets, Lambda (TypeScript), DynamoDB, Polly, S3, Transcribe — same WebSocket contract as local. Not wired until an AWS account exists.
