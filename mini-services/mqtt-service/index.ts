import { Server } from "socket.io";

const PORT = 3003;

const io = new Server(PORT, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

console.log(`MQTT WebSocket service running on port ${PORT}`);

// Simulated device data generation
const deviceMetrics: Record<
  string,
  Array<{ key: string; base: number; variance: number; unit: string }>
> = {
  "温度传感器-T1": [
    { key: "temperature", base: 24, variance: 6, unit: "°C" },
  ],
  "温度传感器-T2": [
    { key: "temperature", base: 22, variance: 5, unit: "°C" },
  ],
  "湿度传感器-H1": [
    { key: "humidity", base: 55, variance: 20, unit: "%" },
  ],
  "压力传感器-P1": [
    { key: "pressure", base: 1013, variance: 10, unit: "hPa" },
  ],
  "温湿度组合-W1": [
    { key: "temperature", base: 20, variance: 4, unit: "°C" },
    { key: "humidity", base: 50, variance: 15, unit: "%" },
  ],
  "光照传感器-LUX1": [
    { key: "illuminance", base: 500, variance: 400, unit: "lux" },
  ],
  "风速传感器-WS1": [
    { key: "wind_speed", base: 3.5, variance: 4, unit: "m/s" },
  ],
  "烟感探测器-S1": [
    { key: "smoke_level", base: 3, variance: 2, unit: "ppm" },
  ],
  "网关-GW1": [
    { key: "cpu_usage", base: 35, variance: 25, unit: "%" },
    { key: "memory_usage", base: 48, variance: 18, unit: "%" },
  ],
};

function generateValue(base: number, variance: number): number {
  return Math.round((base + (Math.random() - 0.5) * 2 * variance) * 100) / 100;
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send initial device status list
  socket.emit("devices:status", Object.keys(deviceMetrics).map((name) => ({
    name,
    status: Math.random() > 0.15 ? "online" : "offline",
  })));

  // Handle subscribe to specific device
  socket.on("device:subscribe", (deviceName: string) => {
    console.log(`Client ${socket.id} subscribing to ${deviceName}`);
    socket.join(`device:${deviceName}`);
  });

  // Handle unsubscribe
  socket.on("device:unsubscribe", (deviceName: string) => {
    socket.leave(`device:${deviceName}`);
  });

  // Handle command to device
  socket.on("device:command", (data: { device: string; command: string; payload?: unknown }) => {
    console.log(`Command to ${data.device}: ${data.command}`);
    // Simulate command acknowledgment
    setTimeout(() => {
      socket.emit("command:ack", {
        device: data.device,
        command: data.command,
        status: "success",
        timestamp: new Date().toISOString(),
      });
    }, 200 + Math.random() * 300);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast simulated telemetry data every 2 seconds
setInterval(() => {
  for (const [deviceName, metrics] of Object.entries(deviceMetrics)) {
    for (const metric of metrics) {
      const value = generateValue(metric.base, metric.variance);
      const payload = {
        device: deviceName,
        key: metric.key,
        value,
        unit: metric.unit,
        timestamp: new Date().toISOString(),
      };

      io.emit("telemetry", payload);
      io.to(`device:${deviceName}`).emit("telemetry:device", payload);
    }
  }
}, 2000);

// Broadcast device status changes every 10 seconds
setInterval(() => {
  const statuses = Object.keys(deviceMetrics).map((name) => ({
    name,
    status: Math.random() > 0.12 ? "online" : Math.random() > 0.5 ? "warning" : "offline",
    lastSeen: new Date().toISOString(),
  }));
  io.emit("devices:status", statuses);
}, 10000);
