"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface TelemetryPoint {
  device: string;
  key: string;
  value: number;
  unit: string;
  timestamp: string;
}

interface DeviceStatus {
  name: string;
  status: string;
  lastSeen?: string;
}

export function useMQTT() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryPoint[]>([]);
  const [deviceStatuses, setDeviceStatuses] = useState<DeviceStatus[]>([]);
  const callbacksRef = useRef<Set<(data: TelemetryPoint) => void>>(new Set());

  const onTelemetry = useCallback((cb: (data: TelemetryPoint) => void) => {
    callbacksRef.current.add(cb);
    return () => { callbacksRef.current.delete(cb); };
  }, []);

  useEffect(() => {
    const socket = io("/?XTransformPort=3003", {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("MQTT WebSocket connected");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("MQTT WebSocket disconnected");
      setConnected(false);
    });

    socket.on("telemetry", (data: TelemetryPoint) => {
      setLatestTelemetry((prev) => {
        const filtered = prev.filter(
          (p) => !(p.device === data.device && p.key === data.key)
        );
        return [...filtered, data].slice(-100);
      });
      callbacksRef.current.forEach((cb) => cb(data));
    });

    socket.on("devices:status", (data: DeviceStatus[]) => {
      setDeviceStatuses(data);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const sendCommand = useCallback(
    (device: string, command: string, payload?: unknown) => {
      socketRef.current?.emit("device:command", { device, command, payload });
    },
    []
  );

  return {
    connected,
    latestTelemetry,
    deviceStatuses,
    onTelemetry,
    sendCommand,
  };
}
