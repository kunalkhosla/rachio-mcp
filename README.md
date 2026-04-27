# rachio-mcp

An [MCP](https://modelcontextprotocol.io) server that wraps the [Rachio public API](https://rachio.readme.io/) so Claude (or any MCP client) can read and adjust your sprinkler controller.

## What it can do

**Read state**
- `list_devices` — controllers, zones, and schedule rules on the account (start here to discover IDs)
- `get_device`, `get_zone`, `get_schedule_rule`, `get_flex_schedule_rule`
- `get_current_schedule` — what's running right now
- `get_device_events` — watering history between two timestamps

**Trigger zones**
- `start_zone` — water one zone for N seconds
- `start_multiple_zones` — run several zones back-to-back
- `stop_water` — stop everything immediately

**Adjust schedules**
- `skip_schedule_rule` — skip the next run
- `start_schedule_rule` — run a saved schedule now
- `set_seasonal_adjustment` — scale watering between -100% and +100%
- `set_rain_delay` — pause all schedules for up to 7 days
- `device_on` / `device_off` — master switch

**Webhooks**
- `list_webhook_event_types`, `list_device_webhooks`
- `create_webhook`, `update_webhook`, `delete_webhook`

## Setup

1. Get an API token from [app.rach.io](https://app.rach.io/) → Account Settings → Get API Key.
2. Install and build:
   ```sh
   npm install
   npm run build
   ```
3. Add to your MCP client config. For Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "rachio": {
         "command": "node",
         "args": ["/absolute/path/to/rachio-mcp/dist/index.js"],
         "env": { "RACHIO_API_TOKEN": "your-token-here" }
       }
     }
   }
   ```
   For Claude Code: add the same entry to `~/.claude.json` under `mcpServers`, or run:
   ```sh
   claude mcp add rachio --env RACHIO_API_TOKEN=your-token-here -- node /absolute/path/to/rachio-mcp/dist/index.js
   ```

## Notes

- All durations are in seconds. Rachio caps single-zone runs at 3 hours (10800s) and rain delay at 7 days (604800s).
- `set_seasonal_adjustment` takes a float in `[-1, 1]` (e.g. `0.2` = +20%, `-0.5` = -50%).
- The Rachio public API does not expose granular schedule editing (start times, days, per-zone durations on existing rules). Use the Rachio app for those, then read/adjust here.

## License

MIT
