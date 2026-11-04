import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEVICE_TYPES = ["sensor", "actuator", "gateway", "camera"] as const;
const PROTOCOLS = ["MQTT", "CoAP", "HTTP", "WebSocket"] as const;

const demoGroups = [
  { name: "工厂车间 A", description: "一号厂房环境监测", color: "#10b981" },
  { name: "办公区域", description: "办公大楼智能化管理", color: "#6366f1" },
  { name: "仓储物流", description: "仓库温湿度及安全监控", color: "#f59e0b" },
  { name: "户外环境", description: "园区外部环境数据采集", color: "#ef4444" },
];

const demoDevices = [
  { name: "温度传感器-T1", type: "sensor", protocol: "MQTT", group: 0, props: { unit: "°C", range: "-40~125" } },
  { name: "温度传感器-T2", type: "sensor", protocol: "MQTT", group: 0, props: { unit: "°C", range: "-40~125" } },
  { name: "湿度传感器-H1", type: "sensor", protocol: "MQTT", group: 0, props: { unit: "%", range: "0~100" } },
  { name: "压力传感器-P1", type: "sensor", protocol: "CoAP", group: 0, props: { unit: "hPa", range: "300~1100" } },
  { name: "智能灯控-L1", type: "actuator", protocol: "MQTT", group: 1, props: { state: "off", brightness: 80 } },
  { name: "空调控制器-AC1", type: "actuator", protocol: "MQTT", group: 1, props: { mode: "cool", targetTemp: 24 } },
  { name: "门禁传感器-D1", type: "sensor", protocol: "HTTP", group: 1, props: { lastEvent: "open", battery: 85 } },
  { name: "视频摄像头-C1", type: "camera", protocol: "WebSocket", group: 1, props: { resolution: "1080p", fps: 30 } },
  { name: "温湿度组合-W1", type: "sensor", protocol: "MQTT", group: 2, props: { temp: 0, humidity: 0 } },
  { name: "烟感探测器-S1", type: "sensor", protocol: "MQTT", group: 2, props: { sensitivity: "high" } },
  { name: "光照传感器-LUX1", type: "sensor", protocol: "CoAP", group: 3, props: { unit: "lux", range: "0~100000" } },
  { name: "风速传感器-WS1", type: "sensor", protocol: "MQTT", group: 3, props: { unit: "m/s", range: "0~60" } },
  { name: "网关-GW1", type: "gateway", protocol: "MQTT", group: 0, props: { firmware: "v2.3.1", connectedDevices: 8 } },
  { name: "智能插座-PL1", type: "actuator", protocol: "MQTT", group: 1, props: { power: 0, state: "off" } },
];

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomMAC(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join(":");
}

function randomIP(): string {
  return `192.168.${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 254) + 1}`;
}

async function main() {
  console.log("Seeding IoT Explorer database...");

  // Clean existing data
  await db.alert.deleteMany();
  await db.alertRule.deleteMany();
  await db.command.deleteMany();
  await db.telemetry.deleteMany();
  await db.device.deleteMany();
  await db.deviceGroup.deleteMany();

  // Create groups
  const groups = await Promise.all(
    demoGroups.map((g) =>
      db.deviceGroup.create({ data: g })
    )
  );
  console.log(`Created ${groups.length} device groups`);

  // Create devices
  const devices = await Promise.all(
    demoDevices.map((d, i) => {
      const status = Math.random() > 0.2 ? "online" : Math.random() > 0.5 ? "warning" : "offline";
      return db.device.create({
        data: {
          name: d.name,
          description: `${d.name} - ${d.type} device`,
          type: d.type,
          protocol: d.protocol,
          status,
          macAddress: randomMAC(),
          ipAddress: randomIP(),
          firmware: d.type === "gateway" ? d.props.firmware : `v1.${Math.floor(Math.random() * 9) + 1}.0`,
          location: ["工厂A区3号位", "办公楼2F", "仓库B区", "园区北门"][d.group],
          groupId: groups[d.group].id,
          properties: JSON.stringify(d.props),
          lastSeenAt: status !== "offline" ? new Date() : new Date(Date.now() - 3600000 * Math.random() * 24),
        },
      });
    })
  );
  console.log(`Created ${devices.length} devices`);

  // Generate telemetry data (last 24 hours, every 5 min)
  const telemetryData: Array<{ deviceId: string; key: string; value: number; unit: string; timestamp: Date }> = [];
  const now = Date.now();

  for (const device of devices) {
    if (device.type !== "sensor" && device.type !== "gateway") continue;

    const props = JSON.parse(device.properties);
    const metrics: Array<{ key: string; unit: string; base: number; variance: number }> = [];

    if (device.name.includes("温度") || device.name.includes("温湿度")) {
      metrics.push({ key: "temperature", unit: "°C", base: 22, variance: 8 });
    }
    if (device.name.includes("湿度") || device.name.includes("温湿度")) {
      metrics.push({ key: "humidity", unit: "%", base: 55, variance: 20 });
    }
    if (device.name.includes("压力")) {
      metrics.push({ key: "pressure", unit: "hPa", base: 1013, variance: 15 });
    }
    if (device.name.includes("光照")) {
      metrics.push({ key: "illuminance", unit: "lux", base: 500, variance: 400 });
    }
    if (device.name.includes("风速")) {
      metrics.push({ key: "wind_speed", unit: "m/s", base: 3, variance: 5 });
    }
    if (device.name.includes("烟感")) {
      metrics.push({ key: "smoke_level", unit: "ppm", base: 5, variance: 3 });
    }
    if (device.type === "gateway") {
      metrics.push({ key: "cpu_usage", unit: "%", base: 30, variance: 25 });
      metrics.push({ key: "memory_usage", unit: "%", base: 45, variance: 20 });
      metrics.push({ key: "uptime", unit: "s", base: 86400, variance: 0 });
    }
    if (device.name.includes("门禁")) {
      metrics.push({ key: "battery", unit: "%", base: 85, variance: 5 });
    }

    // Generate 288 data points (24h * 12 per hour)
    for (const metric of metrics) {
      for (let i = 0; i < 288; i++) {
        const timestamp = new Date(now - (288 - i) * 5 * 60 * 1000);
        const hourFactor = Math.sin((i / 288) * Math.PI * 2 - Math.PI / 2) * 0.3;
        const noise = (Math.random() - 0.5) * 2;
        const value = metric.base * (1 + hourFactor + noise * 0.1);
        const clampedValue = Math.max(0, Math.round(value * 100) / 100);

        telemetryData.push({
          deviceId: device.id,
          key: metric.key,
          value: clampedValue,
          unit: metric.unit,
          timestamp,
        });
      }
    }
  }

  // Batch insert telemetry (SQLite has limits on bind params, chunk it)
  const CHUNK = 500;
  for (let i = 0; i < telemetryData.length; i += CHUNK) {
    const chunk = telemetryData.slice(i, i + CHUNK);
    await db.telemetry.createMany({ data: chunk });
  }
  console.log(`Created ${telemetryData.length} telemetry points`);

  // Create sample alert rules
  await db.alertRule.createMany({
    data: [
      { name: "高温报警", deviceId: devices[0].id, metricKey: "temperature", condition: "gt", threshold: 35, enabled: true },
      { name: "低温报警", deviceId: devices[0].id, metricKey: "temperature", condition: "lt", threshold: 10, enabled: true },
      { name: "高湿报警", deviceId: devices[2].id, metricKey: "humidity", condition: "gt", threshold: 80, enabled: true },
      { name: "烟雾报警", deviceId: devices[9].id, metricKey: "smoke_level", condition: "gt", threshold: 10, enabled: true },
      { name: "CPU 过载", deviceId: devices[12].id, metricKey: "cpu_usage", condition: "gt", threshold: 80, enabled: true },
    ],
  });
  console.log("Created 5 alert rules");

  // Create sample alerts with valid rule IDs
  const rules = await db.alertRule.findMany();
  await db.alert.createMany({
    data: [
      { ruleId: rules[0].id, deviceId: devices[0].id, level: "warning", message: "温度传感器-T1 读数 36.2°C，超过阈值 35°C", acknowledged: false },
      { ruleId: rules[3].id, deviceId: devices[9].id, level: "critical", message: "烟感探测器-S1 检测到异常烟雾浓度 12.5ppm", acknowledged: false },
      { ruleId: rules[0].id, deviceId: devices[3].id, level: "info", message: "压力传感器-P1 已恢复在线", acknowledged: true },
    ],
  });
  console.log("Created 3 sample alerts");

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
