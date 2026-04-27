const BASE_URL = "https://api.rach.io/1/public";

export class RachioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "RachioError";
  }
}

export interface Zone {
  id: string;
  zoneNumber: number;
  name: string;
  enabled: boolean;
  customNozzle?: { name: string };
  customSoil?: { name: string };
  customCrop?: { name: string };
  runtime?: number;
  rootZoneDepth?: number;
}

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  rainDelay?: boolean;
  seasonalAdjustment?: number;
  externalName?: string;
  scheduleType?: string;
  cycleSoak?: boolean;
  totalDuration?: number;
  zones?: Array<{ zoneId: string; duration: number; sortOrder: number }>;
}

export interface FlexScheduleRule extends ScheduleRule {}

export interface Device {
  id: string;
  name: string;
  serialNumber: string;
  macAddress: string;
  status: string;
  on: boolean;
  paused: boolean;
  model: string;
  latitude?: number;
  longitude?: number;
  timeZone?: string;
  zip?: string;
  zones: Zone[];
  scheduleRules?: ScheduleRule[];
  flexScheduleRules?: FlexScheduleRule[];
  rainDelayExpirationDate?: number;
  rainDelayStartDate?: number;
}

export interface Person {
  id: string;
  username: string;
  fullName?: string;
  email?: string;
  devices: Device[];
}

export interface CurrentSchedule {
  zoneId?: string;
  scheduleId?: string;
  zoneStartDate?: number;
  zoneDuration?: number;
  startDate?: number;
  duration?: number;
  status?: string;
  type?: string;
}

export interface Webhook {
  id: string;
  externalId?: string;
  url: string;
  eventTypes: Array<{ id: string; name?: string }>;
}

export interface WebhookEventType {
  id: string;
  name: string;
  type: string;
}

export class RachioClient {
  constructor(private readonly token: string) {
    if (!token) throw new Error("Rachio API token required");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new RachioError(
        `Rachio API ${method} ${path} -> ${res.status}`,
        res.status,
        text,
      );
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // Identity
  getPersonInfo(): Promise<{ id: string }> {
    return this.request("GET", "/person/info");
  }
  getPerson(personId: string): Promise<Person> {
    return this.request("GET", `/person/${personId}`);
  }
  async getMe(): Promise<Person> {
    const { id } = await this.getPersonInfo();
    return this.getPerson(id);
  }

  // Devices / zones / schedules (read)
  getDevice(deviceId: string): Promise<Device> {
    return this.request("GET", `/device/${deviceId}`);
  }
  getCurrentSchedule(deviceId: string): Promise<CurrentSchedule> {
    return this.request("GET", `/device/${deviceId}/current_schedule`);
  }
  getScheduleRule(scheduleRuleId: string): Promise<ScheduleRule> {
    return this.request("GET", `/schedulerule/${scheduleRuleId}`);
  }
  getFlexScheduleRule(scheduleRuleId: string): Promise<FlexScheduleRule> {
    return this.request("GET", `/flexschedulerule/${scheduleRuleId}`);
  }
  getZone(zoneId: string): Promise<Zone> {
    return this.request("GET", `/zone/${zoneId}`);
  }
  getDeviceEvents(
    deviceId: string,
    startTime: number,
    endTime: number,
  ): Promise<unknown> {
    return this.request(
      "GET",
      `/device/${deviceId}/event?startTime=${startTime}&endTime=${endTime}`,
    );
  }

  // Device control
  stopWater(deviceId: string): Promise<void> {
    return this.request("PUT", "/device/stop_water", { id: deviceId });
  }
  rainDelay(deviceId: string, durationSeconds: number): Promise<void> {
    return this.request("PUT", "/device/rain_delay", {
      id: deviceId,
      duration: durationSeconds,
    });
  }
  pauseDevice(deviceId: string, durationSeconds: number): Promise<void> {
    return this.request("PUT", "/device/pause_zone_run", {
      id: deviceId,
      duration: durationSeconds,
    });
  }
  resumeDevice(deviceId: string): Promise<void> {
    return this.request("PUT", "/device/resume_zone_run", { id: deviceId });
  }
  turnOn(deviceId: string): Promise<void> {
    return this.request("PUT", "/device/on", { id: deviceId });
  }
  turnOff(deviceId: string): Promise<void> {
    return this.request("PUT", "/device/off", { id: deviceId });
  }

  // Zone control
  startZone(zoneId: string, durationSeconds: number): Promise<void> {
    return this.request("PUT", "/zone/start", {
      id: zoneId,
      duration: durationSeconds,
    });
  }
  startMultipleZones(
    zones: Array<{ id: string; duration: number; sortOrder: number }>,
  ): Promise<void> {
    return this.request("PUT", "/zone/start_multiple", { zones });
  }

  // Schedule rule control
  skipScheduleRule(scheduleRuleId: string): Promise<void> {
    return this.request("PUT", "/schedulerule/skip", { id: scheduleRuleId });
  }
  startScheduleRule(scheduleRuleId: string): Promise<void> {
    return this.request("PUT", "/schedulerule/start", { id: scheduleRuleId });
  }
  setSeasonalAdjustment(
    scheduleRuleId: string,
    adjustment: number,
  ): Promise<void> {
    return this.request("PUT", "/schedulerule/seasonalAdjustment", {
      id: scheduleRuleId,
      adjustment,
    });
  }

  // Webhooks
  listWebhookEventTypes(): Promise<WebhookEventType[]> {
    return this.request("GET", "/notification/webhook_event_type");
  }
  listDeviceWebhooks(deviceId: string): Promise<Webhook[]> {
    return this.request("GET", `/notification/${deviceId}/webhook`);
  }
  createWebhook(
    deviceId: string,
    url: string,
    eventTypeIds: string[],
    externalId?: string,
  ): Promise<Webhook> {
    return this.request("POST", "/notification/webhook", {
      device: { id: deviceId },
      url,
      eventTypes: eventTypeIds.map((id) => ({ id })),
      externalId,
    });
  }
  updateWebhook(
    webhookId: string,
    url: string,
    eventTypeIds: string[],
    externalId?: string,
  ): Promise<Webhook> {
    return this.request("PUT", "/notification/webhook", {
      id: webhookId,
      url,
      eventTypes: eventTypeIds.map((id) => ({ id })),
      externalId,
    });
  }
  deleteWebhook(webhookId: string): Promise<void> {
    return this.request("DELETE", `/notification/webhook/${webhookId}`);
  }
}
