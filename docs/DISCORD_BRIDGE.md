# Discord bridge

Worlds does not hold a Discord bot token. It sends pages through a small HTTP module that runs next to **your own bot**, on the machine where the bot lives.

## How Worlds reaches it

1. Worlds opens an SSH local port forward to the bot's host (`127.0.0.1:<localPort>` to `127.0.0.1:<remotePort>` on the host).
2. It reads a shared key from a file on the host over SSH (`type "<keyPath>"`) and keeps it in memory only.
3. Every request carries that key in a header (`X-Bridge-Key` by default).

Configure the host, SSH user, port and key file in **Settings > Discord**. SSH must work without a password prompt (key-based login).

## Endpoints the module implements

All are `POST http://127.0.0.1:<port>/worlds/<route>` with a JSON body. Answer `401` for a wrong key and `404` if a route is unknown.

| Route | Body | Returns |
| --- | --- | --- |
| `inspect` | `{ "light"?: true }` | `{ bot: { tag }, guilds: [...], channels: [...], threads: [...], dms: [...] }` |
| `send` | `{ destination: { kind: "channel", "thread" or "dm", id, guildId? }, payload, files? }` | `{ channelId, messageId }` |
| `edit` | `{ channelId, messageId, payload, files? }` | `{ channelId, messageId }` |

`payload` is a Discord Components V2 message rendered by Worlds (see `src-tauri/src/discord/render.rs`). Files arrive base64 encoded.

## Machine-local defaults

Defaults can be baked in at build time from an uncommitted `private/bridge.json`:

```json
{ "enabled": true, "host": "my-bot-host", "user": "me", "remotePort": 30992, "localPort": 30992, "keyPath": "C:/bot/worlds.key", "keyHeader": "X-Bridge-Key" }
```

UI wording can be personalised with an uncommitted `.env.local` (`VITE_BRIDGE_NAME`, `VITE_BRIDGE_HOST`, `VITE_BRIDGE_NETWORK`, `VITE_BRIDGE_MODULE`).
