#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RachioClient, RachioError } from "./rachio.js";

const token = process.env.RACHIO_API_TOKEN;
if (!token) {
  console.error(
    "RACHIO_API_TOKEN env var is required. Get a key from https://app.rach.io/ -> Account Settings -> Get API Key.",
  );
  process.exit(1);
}

const rachio = new RachioClient(token);

const server = new McpServer(
  { name: "rachio-mcp", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Rachio sprinkler controller. Use list_devices first to discover device + zone IDs, then call control or schedule tools. Durations are in seconds. Rachio's public API does NOT expose: (a) zone setting writes (nozzle, soil, slope, shade, root depth, crop) — these must be changed in the Rachio mobile app; (b) creating, editing, or enabling/disabling schedule rules. As workarounds: use disable_zone to pull a zone out of all schedules without editing them, and set_zone_moisture_percent to influence Flex schedule decisions.",
  },
);

// ---------- helpers ----------
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (err: unknown) => {
  const msg =
    err instanceof RachioError
      ? `${err.message}\n${err.body}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
};

const wrap = <A extends Record<string, unknown>>(
  fn: (args: A) => Promise<unknown>,
) => {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
};

// ---------- read tools ----------
server.registerTool(
  "list_devices",
  {
    description:
      "List all Rachio controllers on the account, including zones and schedule rules. Use this first to find IDs.",
    inputSchema: {},
  },
  wrap(async () => {
    const me = await rachio.getMe();
    return {
      personId: me.id,
      username: me.username,
      devices: me.devices.map((d) => ({
        id: d.id,
        name: d.name,
        model: d.model,
        status: d.status,
        on: d.on,
        paused: d.paused,
        timeZone: d.timeZone,
        rainDelayExpirationDate: d.rainDelayExpirationDate,
        zones: d.zones
          .filter((z) => z.enabled)
          .sort((a, b) => a.zoneNumber - b.zoneNumber)
          .map((z) => ({
            id: z.id,
            zoneNumber: z.zoneNumber,
            name: z.name,
            enabled: z.enabled,
          })),
        scheduleRules: (d.scheduleRules ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          seasonalAdjustment: s.seasonalAdjustment,
        })),
        flexScheduleRules: (d.flexScheduleRules ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          seasonalAdjustment: s.seasonalAdjustment,
        })),
      })),
    };
  }),
);

server.registerTool(
  "get_device",
  {
    description: "Get full details for a single Rachio controller.",
    inputSchema: { deviceId: z.string().describe("Rachio device ID") },
  },
  wrap(({ deviceId }) => rachio.getDevice(deviceId as string)),
);

server.registerTool(
  "get_zone",
  {
    description: "Get details for a single zone (nozzle, soil, runtime, etc).",
    inputSchema: { zoneId: z.string() },
  },
  wrap(({ zoneId }) => rachio.getZone(zoneId as string)),
);

server.registerTool(
  "get_current_schedule",
  {
    description:
      "Get what's currently running on the device (zone, start time, duration). Empty object if nothing is running.",
    inputSchema: { deviceId: z.string() },
  },
  wrap(({ deviceId }) => rachio.getCurrentSchedule(deviceId as string)),
);

server.registerTool(
  "get_schedule_rule",
  {
    description:
      "Get a fixed schedule rule by ID (zones, durations, days, seasonal adjustment).",
    inputSchema: { scheduleRuleId: z.string() },
  },
  wrap(({ scheduleRuleId }) =>
    rachio.getScheduleRule(scheduleRuleId as string),
  ),
);

server.registerTool(
  "get_flex_schedule_rule",
  {
    description: "Get a Flex (smart) schedule rule by ID.",
    inputSchema: { scheduleRuleId: z.string() },
  },
  wrap(({ scheduleRuleId }) =>
    rachio.getFlexScheduleRule(scheduleRuleId as string),
  ),
);

server.registerTool(
  "get_device_events",
  {
    description:
      "Get device events between two unix-millisecond timestamps. Useful for watering history.",
    inputSchema: {
      deviceId: z.string(),
      startTimeMs: z.number().int().describe("Unix epoch milliseconds"),
      endTimeMs: z.number().int().describe("Unix epoch milliseconds"),
    },
  },
  wrap(({ deviceId, startTimeMs, endTimeMs }) =>
    rachio.getDeviceEvents(
      deviceId as string,
      startTimeMs as number,
      endTimeMs as number,
    ),
  ),
);

// ---------- control tools ----------
server.registerTool(
  "start_zone",
  {
    description:
      "Start watering a single zone for a given number of seconds. Max 10800 (3h).",
    inputSchema: {
      zoneId: z.string(),
      durationSeconds: z.number().int().min(1).max(10800),
    },
  },
  wrap(async ({ zoneId, durationSeconds }) => {
    await rachio.startZone(zoneId as string, durationSeconds as number);
    return { started: true, zoneId, durationSeconds };
  }),
);

server.registerTool(
  "start_multiple_zones",
  {
    description:
      "Run a sequence of zones back-to-back. Each zone has its own duration; sortOrder controls run order (0-based).",
    inputSchema: {
      zones: z
        .array(
          z.object({
            zoneId: z.string(),
            durationSeconds: z.number().int().min(1).max(10800),
            sortOrder: z.number().int().min(0),
          }),
        )
        .min(1),
    },
  },
  wrap(async ({ zones }) => {
    const list = (
      zones as Array<{
        zoneId: string;
        durationSeconds: number;
        sortOrder: number;
      }>
    ).map((z) => ({
      id: z.zoneId,
      duration: z.durationSeconds,
      sortOrder: z.sortOrder,
    }));
    await rachio.startMultipleZones(list);
    return { started: true, count: list.length };
  }),
);

server.registerTool(
  "stop_water",
  {
    description: "Immediately stop any watering on the device.",
    inputSchema: { deviceId: z.string() },
  },
  wrap(async ({ deviceId }) => {
    await rachio.stopWater(deviceId as string);
    return { stopped: true };
  }),
);

server.registerTool(
  "pause_device",
  {
    description:
      "Pause the currently running zone on the device for N seconds. Use resume_device to continue.",
    inputSchema: {
      deviceId: z.string(),
      durationSeconds: z.number().int().min(1).max(3600),
    },
  },
  wrap(async ({ deviceId, durationSeconds }) => {
    await rachio.pauseDevice(deviceId as string, durationSeconds as number);
    return { paused: true, durationSeconds };
  }),
);

server.registerTool(
  "resume_device",
  {
    description: "Resume a paused zone run on the device.",
    inputSchema: { deviceId: z.string() },
  },
  wrap(async ({ deviceId }) => {
    await rachio.resumeDevice(deviceId as string);
    return { resumed: true };
  }),
);

server.registerTool(
  "enable_zone",
  {
    description:
      "Enable a zone (allow it to run on schedules). Useful to undo a temporary disable_zone.",
    inputSchema: { zoneId: z.string() },
  },
  wrap(async ({ zoneId }) => {
    await rachio.enableZone(zoneId as string);
    return { enabled: true, zoneId };
  }),
);

server.registerTool(
  "disable_zone",
  {
    description:
      "Disable a zone so it won't run on any schedule. Useful for temporarily pulling a zone out of automated watering (e.g., during plant establishment) without editing schedules. Manual start_zone still works on disabled zones.",
    inputSchema: { zoneId: z.string() },
  },
  wrap(async ({ zoneId }) => {
    await rachio.disableZone(zoneId as string);
    return { disabled: true, zoneId };
  }),
);

server.registerTool(
  "set_zone_moisture_percent",
  {
    description:
      "Tell Rachio that a zone's soil is at X% moisture (0.0 to 1.0). Flex schedules use this to decide when to water. Set to 1.0 after a heavy manual watering to prevent immediate re-watering; set to 0.0 to force the next Flex run to water this zone.",
    inputSchema: {
      zoneId: z.string(),
      percent: z
        .number()
        .min(0)
        .max(1)
        .describe("0.0 = bone dry, 1.0 = fully saturated"),
    },
  },
  wrap(async ({ zoneId, percent }) => {
    await rachio.setZoneMoisturePercent(zoneId as string, percent as number);
    return { zoneId, percent };
  }),
);

server.registerTool(
  "set_zone_moisture_level",
  {
    description:
      "Tell Rachio that a zone's soil moisture is at level (in mm). Range: 0 to (depth_of_water + 10% of depth_of_water). Most users want set_zone_moisture_percent instead.",
    inputSchema: {
      zoneId: z.string(),
      levelMm: z.number().min(0).describe("Moisture level in mm"),
    },
  },
  wrap(async ({ zoneId, levelMm }) => {
    await rachio.setZoneMoistureLevel(zoneId as string, levelMm as number);
    return { zoneId, levelMm };
  }),
);

server.registerTool(
  "set_rain_delay",
  {
    description:
      "Pause all schedules on the device for N seconds (max 604800 = 7 days). Set durationSeconds to 0 to clear an active rain delay.",
    inputSchema: {
      deviceId: z.string(),
      durationSeconds: z.number().int().min(0).max(604800),
    },
  },
  wrap(async ({ deviceId, durationSeconds }) => {
    await rachio.rainDelay(deviceId as string, durationSeconds as number);
    return { rainDelaySeconds: durationSeconds };
  }),
);

server.registerTool(
  "device_on",
  {
    description: "Enable schedules on the controller (undo device_off).",
    inputSchema: { deviceId: z.string() },
  },
  wrap(async ({ deviceId }) => {
    await rachio.turnOn(deviceId as string);
    return { on: true };
  }),
);

server.registerTool(
  "device_off",
  {
    description:
      "Disable all watering on the controller until turned back on. Stronger than rain delay.",
    inputSchema: { deviceId: z.string() },
  },
  wrap(async ({ deviceId }) => {
    await rachio.turnOff(deviceId as string);
    return { off: true };
  }),
);

// ---------- schedule tools ----------
server.registerTool(
  "skip_schedule_rule",
  {
    description: "Skip the next run of a fixed schedule rule.",
    inputSchema: { scheduleRuleId: z.string() },
  },
  wrap(async ({ scheduleRuleId }) => {
    await rachio.skipScheduleRule(scheduleRuleId as string);
    return { skipped: true };
  }),
);

server.registerTool(
  "start_schedule_rule",
  {
    description: "Run a schedule rule right now (manual trigger of a saved schedule).",
    inputSchema: { scheduleRuleId: z.string() },
  },
  wrap(async ({ scheduleRuleId }) => {
    await rachio.startScheduleRule(scheduleRuleId as string);
    return { started: true };
  }),
);

server.registerTool(
  "set_seasonal_adjustment",
  {
    description:
      "Set the seasonal adjustment for a schedule rule. Value is a fraction: -1.0 (off) to 1.0 (+100%). 0.0 means no adjustment.",
    inputSchema: {
      scheduleRuleId: z.string(),
      adjustment: z.number().min(-1).max(1),
    },
  },
  wrap(async ({ scheduleRuleId, adjustment }) => {
    await rachio.setSeasonalAdjustment(
      scheduleRuleId as string,
      adjustment as number,
    );
    return { scheduleRuleId, adjustment };
  }),
);

// ---------- webhook tools ----------
server.registerTool(
  "list_webhook_event_types",
  {
    description:
      "List all webhook event types Rachio can notify on (zone started, schedule completed, etc).",
    inputSchema: {},
  },
  wrap(() => rachio.listWebhookEventTypes()),
);

server.registerTool(
  "list_device_webhooks",
  {
    description: "List webhooks registered on a device.",
    inputSchema: { deviceId: z.string() },
  },
  wrap(({ deviceId }) => rachio.listDeviceWebhooks(deviceId as string)),
);

server.registerTool(
  "create_webhook",
  {
    description:
      "Subscribe a public URL to Rachio events for a device. Rachio will POST JSON to the URL.",
    inputSchema: {
      deviceId: z.string(),
      url: z.string().url(),
      eventTypeIds: z
        .array(z.string())
        .min(1)
        .describe("IDs from list_webhook_event_types"),
      externalId: z.string().optional(),
    },
  },
  wrap(({ deviceId, url, eventTypeIds, externalId }) =>
    rachio.createWebhook(
      deviceId as string,
      url as string,
      eventTypeIds as string[],
      externalId as string | undefined,
    ),
  ),
);

server.registerTool(
  "update_webhook",
  {
    description: "Update an existing webhook's URL or event subscriptions.",
    inputSchema: {
      webhookId: z.string(),
      url: z.string().url(),
      eventTypeIds: z.array(z.string()).min(1),
      externalId: z.string().optional(),
    },
  },
  wrap(({ webhookId, url, eventTypeIds, externalId }) =>
    rachio.updateWebhook(
      webhookId as string,
      url as string,
      eventTypeIds as string[],
      externalId as string | undefined,
    ),
  ),
);

server.registerTool(
  "delete_webhook",
  {
    description: "Delete a webhook subscription by ID.",
    inputSchema: { webhookId: z.string() },
  },
  wrap(async ({ webhookId }) => {
    await rachio.deleteWebhook(webhookId as string);
    return { deleted: true };
  }),
);

// ---------- run ----------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("rachio-mcp ready on stdio");
