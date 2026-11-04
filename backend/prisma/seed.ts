import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

function generateDeviceId(productId: string, deviceName: string): string {
  const input = `${productId}/${deviceName}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 64);
}

async function main() {
  console.log('🌱 开始种子数据初始化...');

  // 清空旧数据(顺序: 先子表后主表, 或依赖级联删除)
  await prisma.deviceActionLog.deleteMany();
  await prisma.deviceEventLog.deleteMany();
  await prisma.devicePropertyHistory.deleteMany();
  await prisma.deviceShadow.deleteMany();
  await prisma.device.deleteMany();
  await prisma.thingModelProperty.deleteMany();
  await prisma.thingModelEvent.deleteMany();
  await prisma.thingModelAction.deleteMany();
  await prisma.product.deleteMany();

  // ============================================================
  // 1. 产品 + 物模型
  // ============================================================
  const thermostatProps = [
    { identifier: 'temperature', name: '当前温度', dataType: 'float', accessMode: 'rw', description: '设备当前温度读数', spec: { min: -40, max: 85, step: 0.1, unit: '°C', unitName: '摄氏度' }, required: true, sortOrder: 1 },
    { identifier: 'humidity', name: '当前湿度', dataType: 'float', accessMode: 'r', description: '设备当前湿度读数', spec: { min: 0, max: 100, step: 0.1, unit: '%', unitName: '百分比' }, required: true, sortOrder: 2 },
    { identifier: 'target_temperature', name: '目标温度', dataType: 'int', accessMode: 'rw', description: '用户设定的目标温度', spec: { min: 16, max: 32, step: 1, unit: '°C', unitName: '摄氏度' }, required: true, sortOrder: 3 },
    { identifier: 'power_switch', name: '电源开关', dataType: 'bool', accessMode: 'rw', description: '设备电源开关', spec: { '0': '关', '1': '开' }, required: true, sortOrder: 4 },
    { identifier: 'working_mode', name: '工作模式', dataType: 'enum', accessMode: 'rw', description: '温控器工作模式', spec: { enumList: [{ value: 'auto', label: '自动' }, { value: 'cool', label: '制冷' }, { value: 'heat', label: '制热' }, { value: 'fan', label: '送风' }, { value: 'eco', label: '节能' }] }, required: true, sortOrder: 5 },
    { identifier: 'error_code', name: '故障码', dataType: 'int', accessMode: 'r', description: '设备故障码，0表示正常', spec: { min: 0, max: 65535 }, required: false, sortOrder: 6 },
  ];

  const sensorProps = [
    { identifier: 'temperature', name: '环境温度', dataType: 'float', accessMode: 'r', description: '环境温度', spec: { min: -40, max: 85, step: 0.1, unit: '°C' }, required: true, sortOrder: 1 },
    { identifier: 'humidity', name: '环境湿度', dataType: 'float', accessMode: 'r', description: '环境湿度', spec: { min: 0, max: 100, step: 0.1, unit: '%' }, required: true, sortOrder: 2 },
    { identifier: 'pm25', name: 'PM2.5', dataType: 'float', accessMode: 'r', description: '细颗粒物浓度', spec: { min: 0, max: 1000, step: 1, unit: 'μg/m³' }, required: false, sortOrder: 3 },
  ];

  const gatewayProps = [
    { identifier: 'cpu_usage', name: 'CPU使用率', dataType: 'float', accessMode: 'r', description: '网关CPU使用率', spec: { min: 0, max: 100, step: 0.1, unit: '%' }, required: true, sortOrder: 1 },
    { identifier: 'memory_usage', name: '内存使用率', dataType: 'float', accessMode: 'r', description: '网关内存使用率', spec: { min: 0, max: 100, step: 0.1, unit: '%' }, required: true, sortOrder: 2 },
    { identifier: 'sub_device_count', name: '子设备数量', dataType: 'int', accessMode: 'r', description: '已接入子设备数', spec: { min: 0, max: 255 }, required: false, sortOrder: 3 },
  ];

  const lightProps = [
    { identifier: 'brightness', name: '亮度', dataType: 'int', accessMode: 'rw', description: '灯光亮度', spec: { min: 0, max: 100, step: 1, unit: '%' }, required: true, sortOrder: 1 },
    { identifier: 'color_temperature', name: '色温', dataType: 'int', accessMode: 'rw', description: '灯光色温', spec: { min: 2700, max: 6500, step: 100, unit: 'K' }, required: false, sortOrder: 2 },
    { identifier: 'switch', name: '开关', dataType: 'bool', accessMode: 'rw', description: '灯开关', spec: { '0': '关', '1': '开' }, required: true, sortOrder: 3 },
  ];

  const productsData = [
    {
      productId: 'prod-a1b2c3d4', productName: '智能温控器', category: '智能家电',
      protocolType: 'MQTT', networkType: 'WiFi', dataProtocol: 'MQTT-JSON',
      authType: 'one-machine-one-secret', nodeType: 'device',
      description: '支持温度采集与远程控温的智能恒温器',
      props: thermostatProps,
      events: [
        { identifier: 'high_temperature_alarm', name: '高温告警', eventType: 'warn', description: '温度超过告警阈值时触发', outputParams: [{ identifier: 'current_temp', name: '当前温度', dataType: 'float', spec: { unit: '°C' } }, { identifier: 'threshold', name: '告警阈值', dataType: 'float', spec: { unit: '°C' } }], sortOrder: 1 },
      ],
      actions: [
        { identifier: 'reboot', name: '重启设备', description: '远程重启温控器', inputParams: [], outputParams: [], asyncFlag: false, callStrategy: 'direct', sortOrder: 1 },
      ],
    },
    {
      productId: 'prod-e5f6g7h8', productName: '工业温湿度传感器', category: '工业传感',
      protocolType: 'MQTT', networkType: 'Ethernet', dataProtocol: 'MQTT-JSON',
      authType: 'one-machine-one-secret', nodeType: 'device',
      description: '工业级高精度温湿度采集传感器',
      props: sensorProps, events: [], actions: [],
    },
    {
      productId: 'prod-i9j0k1l2', productName: '智能网关', category: '网关设备',
      protocolType: 'MQTT', networkType: 'Ethernet', dataProtocol: 'MQTT-JSON',
      authType: 'one-machine-one-secret', nodeType: 'gateway',
      description: '支持ZigBee/BLE子设备接入的智能网关',
      props: gatewayProps, events: [], actions: [],
    },
    {
      productId: 'prod-m3n4o5p6', productName: '智能照明灯', category: '智能家电',
      protocolType: 'MQTT', networkType: 'WiFi', dataProtocol: 'MQTT-JSON',
      authType: 'one-machine-one-secret', nodeType: 'device',
      description: '支持亮度/色温调节的智能LED灯',
      props: lightProps, events: [], actions: [],
    },
  ];

  for (const p of productsData) {
    await prisma.product.create({
      data: {
        productId: p.productId,
        productName: p.productName,
        category: p.category,
        protocolType: p.protocolType,
        networkType: p.networkType,
        dataProtocol: p.dataProtocol,
        authType: p.authType,
        nodeType: p.nodeType,
        description: p.description,
        thingModel: { properties: p.props, events: p.events, actions: p.actions },
        thingModelProperties: { create: p.props },
        thingModelEvents: { create: p.events },
        thingModelActions: { create: p.actions },
      },
    });
    console.log(`  ✅ 产品: ${p.productName} (${p.productId}) — ${p.props.length} 属性`);
  }

  // ============================================================
  // 2. 设备(跨产品 12 台, 不同状态分布) + 影子 + 初始历史数据
  // ============================================================
  const devicesData: Array<{
    productId: string; deviceName: string; status: string;
    firmware: string; loginMinutesAgo?: number;
  }> = [
    { productId: 'prod-a1b2c3d4', deviceName: 'living-room-thermo-01', status: 'online', firmware: 'v2.1.3', loginMinutesAgo: 32 },
    { productId: 'prod-a1b2c3d4', deviceName: 'bedroom-thermo-02', status: 'online', firmware: 'v2.1.3', loginMinutesAgo: 28 },
    { productId: 'prod-a1b2c3d4', deviceName: 'study-thermo-03', status: 'offline', firmware: 'v2.0.8', loginMinutesAgo: 240 },
    { productId: 'prod-e5f6g7h8', deviceName: 'ws-sensor-plant-a', status: 'online', firmware: 'v1.5.2', loginMinutesAgo: 25 },
    { productId: 'prod-e5f6g7h8', deviceName: 'ws-sensor-plant-b', status: 'online', firmware: 'v1.5.2', loginMinutesAgo: 18 },
    { productId: 'prod-e5f6g7h8', deviceName: 'ws-sensor-warehouse', status: 'offline', firmware: 'v1.4.0', loginMinutesAgo: 600 },
    { productId: 'prod-i9j0k1l2', deviceName: 'gateway-gw-01', status: 'online', firmware: 'v2.3.1', loginMinutesAgo: 15 },
    { productId: 'prod-i9j0k1l2', deviceName: 'gateway-gw-02', status: 'offline', firmware: 'v2.3.1', loginMinutesAgo: 1440 },
    { productId: 'prod-m3n4o5p6', deviceName: 'light-livingroom', status: 'online', firmware: 'v1.2.0', loginMinutesAgo: 10 },
    { productId: 'prod-m3n4o5p6', deviceName: 'light-bedroom', status: 'offline', firmware: 'v1.2.0', loginMinutesAgo: 720 },
    { productId: 'prod-m3n4o5p6', deviceName: 'light-kitchen', status: 'not-activated', firmware: 'v1.0.0' },
    { productId: 'prod-a1b2c3d4', deviceName: 'hallway-thermo-04', status: 'not-activated', firmware: 'v1.0.0' },
  ];

  const now = Date.now();
  const onlineDevices: Array<{ deviceId: string; productId: string; deviceName: string }> = [];

  for (const d of devicesData) {
    const deviceId = generateDeviceId(d.productId, d.deviceName);
    const lastLoginAt = d.loginMinutesAgo ? new Date(now - d.loginMinutesAgo * 60_000) : null;

    await prisma.device.create({
      data: {
        deviceId,
        deviceName: d.deviceName,
        deviceSecret: generateDeviceSecret(),
        productId: d.productId,
        status: d.status,
        firmwareVersion: d.firmware,
        lastLoginAt,
        tags: { room: d.deviceName.split('-')[0] },
      },
    });

    await prisma.deviceShadow.create({
      data: {
        deviceId,
        reported: {},
        desired: {},
        metadata: { reported: {}, desired: {} },
      },
    });

    if (d.status === 'online') {
      onlineDevices.push({ deviceId, productId: d.productId, deviceName: d.deviceName });
    }
    console.log(`  ✅ 设备: ${d.deviceName} (${d.status})`);
  }

  // ============================================================
  // 3. 初始属性历史 + 事件(制造概览页动态数据)
  // ============================================================
  for (const dev of onlineDevices.slice(0, 4)) {
    const points = 5;
    for (let i = points; i > 0; i--) {
      const ts = new Date(now - i * 5 * 60_000);
      const temp = 22 + Math.sin(i / 3) * 3 + Math.random();
      const hum = 50 + Math.cos(i / 4) * 8 + Math.random() * 2;
      await prisma.devicePropertyHistory.createMany({
        data: [
          { deviceId: dev.deviceId, identifier: 'temperature', value: Number(temp.toFixed(1)), timestamp: ts },
          { deviceId: dev.deviceId, identifier: 'humidity', value: Number(hum.toFixed(1)), timestamp: ts },
        ],
      });
    }
    // 更新影子 reported
    const lastTemp = (22 + Math.sin(1 / 3) * 3).toFixed(1);
    const lastHum = (50 + Math.cos(1 / 4) * 8).toFixed(1);
    await prisma.deviceShadow.update({
      where: { deviceId: dev.deviceId },
      data: {
        reported: { temperature: Number(lastTemp), humidity: Number(lastHum) },
        reportedVersion: 1,
        lastReportedAt: new Date(now - 5 * 60_000),
      },
    });
  }

  // 一条历史告警事件
  if (onlineDevices.length > 0) {
    await prisma.deviceEventLog.create({
      data: {
        deviceId: onlineDevices[0].deviceId,
        eventId: 'high_temperature_alarm',
        eventType: 'alert',
        payload: { current_temp: 32.5, threshold: 30 },
        timestamp: new Date(now - 18 * 60_000),
      },
    });
  }

  console.log('🌱 种子数据初始化完成!');
  console.log(`   产品: 4 | 设备: ${devicesData.length} | 在线: ${onlineDevices.length}`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
