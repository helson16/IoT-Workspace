-- ============================================================
-- 物联网平台 · 第一阶段：物模型解析与设备影子系统
-- Database Schema DDL (PostgreSQL 15+)
-- ============================================================

-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 产品表 (Products)
-- 存储产品定义，包含物模型版本、通信协议、认证方式等元信息
-- ============================================================
CREATE TABLE products (
    product_id      VARCHAR(64)  PRIMARY KEY,                       -- 产品唯一ID，格式: prod-xxxxxxxx
    product_name    VARCHAR(128) NOT NULL,                          -- 产品名称
    category        VARCHAR(64)  NOT NULL DEFAULT 'Custom',         -- 产品品类（智能家电/工业传感/智慧城市...）
    protocol_type   VARCHAR(32)  NOT NULL DEFAULT 'MQTT',           -- 接入协议: MQTT | CoAP | HTTP | WebSocket
    network_type    VARCHAR(32)  NOT NULL DEFAULT 'WiFi',           -- 联网方式: WiFi | Cellular | Ethernet | BLE | ZigBee | LoRa | NB-IoT
    data_protocol   VARCHAR(32)  NOT NULL DEFAULT 'MQTT-JSON',      -- 数据协议: MQTT-JSON | Modbus | OPC-UA | Custom
    auth_type       VARCHAR(32)  NOT NULL DEFAULT 'one-machine-one-secret', -- 认证方式: one-machine-one-secret | ticket-auth
    node_type       VARCHAR(32)  NOT NULL DEFAULT 'device',         -- 节点类型: device | gateway | sub-device
    description     TEXT,                                           -- 产品描述
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',         -- 状态: active | archived | developing
    thing_model_version INTEGER NOT NULL DEFAULT 1,                  -- 物模型版本号
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  products              IS '产品定义表';
COMMENT ON COLUMN products.product_id    IS '产品唯一标识，格式 prod-xxxxxxxx，由服务端生成';
COMMENT ON COLUMN products.auth_type     IS '认证类型: one-machine-one-secret(一机一密) | ticket-auth(动态令牌)';
COMMENT ON COLUMN products.node_type     IS '节点类型: device(直连设备) | gateway(网关设备) | sub-device(子设备)';
COMMENT ON COLUMN products.thing_model_version IS '物模型版本号，每次物模型变更递增';

-- 产品名称唯一索引
CREATE UNIQUE INDEX idx_products_name ON products (product_name);

-- ============================================================
-- 2. 设备表 (Devices)
-- 存储设备实例，包含一机一密凭证、状态、固件版本等
-- ============================================================
CREATE TABLE devices (
    device_id         VARCHAR(128) PRIMARY KEY,                     -- 设备唯一ID = SHA256(product_id + device_name)
    device_name       VARCHAR(128) NOT NULL,                        -- 设备名称（产品下唯一）
    device_secret     VARCHAR(128) NOT NULL,                        -- 设备密钥（一机一密），32字节随机Hex
    product_id        VARCHAR(64)  NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    status            VARCHAR(16)  NOT NULL DEFAULT 'not-activated', -- 状态: online | offline | not-activated | disabled
    last_login_at     TIMESTAMPTZ,                                  -- 最近一次登录时间
    last_logout_at    TIMESTAMPTZ,                                  -- 最近一次离线时间
    last_ip           INET,                                         -- 最近连接IP
    firmware_version  VARCHAR(64)  NOT NULL DEFAULT '1.0.0',        -- 当前固件版本
    tags              JSONB        NOT NULL DEFAULT '{}',           -- 设备标签 {"location":"车间A", "line":1}
    extra_info        JSONB        NOT NULL DEFAULT '{}',           -- 扩展信息（协议特有的连接参数等）
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- 产品下设备名称唯一
    CONSTRAINT uq_device_product_name UNIQUE (product_id, device_name)
);

COMMENT ON TABLE  devices                     IS '设备实例表';
COMMENT ON COLUMN devices.device_id           IS '设备全局唯一ID，由 product_id + device_name 派生';
COMMENT ON COLUMN devices.device_secret       IS '一机一密密钥，32字节Hex随机字符串，注册时生成';
COMMENT ON COLUMN devices.status              IS '设备状态: online(在线) | offline(离线) | not-activated(未激活) | disabled(已禁用)';

-- 高频查询索引
CREATE INDEX idx_devices_product_id    ON devices (product_id);
CREATE INDEX idx_devices_status         ON devices (status);
CREATE INDEX idx_devices_last_login     ON devices (last_login_at DESC);
CREATE INDEX idx_devices_tags           ON devices USING GIN (tags);

-- ============================================================
-- 3. 物模型 — 属性定义表 (Thing Model Properties)
-- 定义产品下所有设备可上报/下发的属性标识符、数据类型、取值范围
-- ============================================================
CREATE TABLE thing_model_properties (
    id              SERIAL       PRIMARY KEY,
    product_id      VARCHAR(64)  NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    identifier      VARCHAR(64)  NOT NULL,                        -- 属性标识符，如 temperature, power_switch
    name            VARCHAR(128) NOT NULL,                        -- 属性名称（中英文）
    data_type       VARCHAR(32)  NOT NULL,                        -- 数据类型: int | long | float | double | string | bool | enum | timestamp | struct | array
    access_mode     VARCHAR(8)   NOT NULL DEFAULT 'rw',           -- 访问模式: rw(读写) | r(只读) | w(只写)
    description     TEXT,                                         -- 属性描述
    spec            JSONB        NOT NULL DEFAULT '{}',           -- 类型规格定义（min, max, step, unit, unitName, enumList, structMembers 等）
    required        BOOLEAN      NOT NULL DEFAULT FALSE,          -- 是否必填属性
    sort_order      INTEGER      NOT NULL DEFAULT 0,              -- 排序序号
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_property_product_id_identifier UNIQUE (product_id, identifier)
);

COMMENT ON TABLE  thing_model_properties IS '物模型属性定义表';
COMMENT ON COLUMN thing_model_properties.identifier  IS '属性唯一标识，如 temperature, humidity, power_switch';
COMMENT ON COLUMN thing_model_properties.data_type   IS '数据类型: int|long|float|double|string|bool|enum|timestamp|struct|array';
COMMENT ON COLUMN thing_model_properties.access_mode IS '读写模式: rw(读写)|r(只读)|w(只写)';
COMMENT ON COLUMN thing_model_properties.spec        IS 'JSON规格: 数值型{min,max,step,unit}; 枚举型{enumList:[{value,label}]}; 结构体{members:[...]}';

CREATE INDEX idx_tm_props_product ON thing_model_properties (product_id);

-- ============================================================
-- 4. 物模型 — 事件定义表 (Thing Model Events)
-- 定义设备可主动上报的事件类型及输出参数
-- ============================================================
CREATE TABLE thing_model_events (
    id              SERIAL       PRIMARY KEY,
    product_id      VARCHAR(64)  NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    identifier      VARCHAR(64)  NOT NULL,                        -- 事件标识符，如 high_temperature_alarm
    name            VARCHAR(128) NOT NULL,                        -- 事件名称
    event_type      VARCHAR(16)  NOT NULL DEFAULT 'info',         -- 事件类型: info(信息) | warn(告警) | error(故障)
    description     TEXT,                                         -- 事件描述
    output_params   JSONB        NOT NULL DEFAULT '[]',           -- 输出参数定义数组 [{identifier, name, dataType, spec}]
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_event_product_id_identifier UNIQUE (product_id, identifier)
);

COMMENT ON TABLE  thing_model_events IS '物模型事件定义表';
COMMENT ON COLUMN thing_model_events.event_type   IS '事件类型: info(普通信息) | warn(告警) | error(故障)';
COMMENT ON COLUMN thing_model_events.output_params IS '输出参数JSON数组，每个元素与属性定义的 spec 结构一致';

CREATE INDEX idx_tm_events_product ON thing_model_events (product_id);

-- ============================================================
-- 5. 物模型 — 行为/服务定义表 (Thing Model Actions/Services)
-- 定义云端可对设备下发的服务调用及输入输出参数
-- ============================================================
CREATE TABLE thing_model_actions (
    id              SERIAL       PRIMARY KEY,
    product_id      VARCHAR(64)  NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    identifier      VARCHAR(64)  NOT NULL,                        -- 行为标识符，如 set_temperature, reboot
    name            VARCHAR(128) NOT NULL,                        -- 行为名称
    description     TEXT,                                         -- 行为描述
    input_params    JSONB        NOT NULL DEFAULT '[]',           -- 输入参数定义数组
    output_params   JSONB        NOT NULL DEFAULT '[]',           -- 输出参数定义数组
    async_flag      BOOLEAN      NOT NULL DEFAULT FALSE,          -- 是否异步调用
    call_strategy   VARCHAR(16)  NOT NULL DEFAULT 'direct',       -- 调用策略: direct(直连) | queue(排队) | broadcast(广播)
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_action_product_id_identifier UNIQUE (product_id, identifier)
);

COMMENT ON TABLE  thing_model_actions IS '物模型行为/服务定义表';
COMMENT ON COLUMN thing_model_actions.async_flag    IS 'true=异步调用(设备需异步回复), false=同步调用';
COMMENT ON COLUMN thing_model_actions.call_strategy IS '调用策略: direct(直接下发) | queue(消息队列) | broadcast(广播)';

CREATE INDEX idx_tm_actions_product ON thing_model_actions (product_id);

-- ============================================================
-- 6. 设备影子表 (Device Shadow)
-- 缓存设备的 reported(上报状态) 与 desired(期望状态)，实现云端-设备状态同步
-- ============================================================
CREATE TABLE device_shadows (
    device_id          VARCHAR(128) PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    reported           JSONB        NOT NULL DEFAULT '{}',         -- 设备上报的最新状态 {"temperature":25.6, "power_switch":1}
    desired            JSONB        NOT NULL DEFAULT '{}',         -- 云端期望的状态 {"power_switch":0}
    reported_version   BIGINT       NOT NULL DEFAULT 0,            -- reported 状态版本号（乐观锁）
    desired_version    BIGINT       NOT NULL DEFAULT 0,            -- desired 状态版本号（乐观锁）
    last_reported_at   TIMESTAMPTZ,                                 -- 最近一次 reported 更新时间
    last_desired_at    TIMESTAMPTZ,                                 -- 最近一次 desired 更新时间
    metadata           JSONB        NOT NULL DEFAULT '{}',         -- 元数据：每个字段的最后更新时间戳
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  device_shadows          IS '设备影子表：存储设备的 reported 与 desired 状态';
COMMENT ON COLUMN device_shadows.reported  IS '设备上报的最新状态，JSON键为属性标识符';
COMMENT ON COLUMN device_shadows.desired   IS '云端期望状态，设备拉取后应同步到 reported 并清除对应 desired 键';
COMMENT ON COLUMN device_shadows.reported_version IS 'reported版本号，用于乐观并发控制';
COMMENT ON COLUMN device_shadows.desired_version  IS 'desired版本号，用于乐观并发控制';
COMMENT ON COLUMN device_shadows.metadata  IS '元数据，记录每个属性的最后上报/期望时间: {"temperature":{"reported_ts":1692960000,"desired_ts":1692960001}}';

CREATE INDEX idx_shadows_last_reported ON device_shadows (last_reported_at DESC);

-- ============================================================
-- 7. 设备属性上报历史表 (Device Property History)
-- 存储设备属性的历史上报数据，用于时序查询和趋势分析
-- ============================================================
CREATE TABLE device_property_history (
    id          BIGSERIAL   PRIMARY KEY,
    device_id   VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    identifier  VARCHAR(64)  NOT NULL,                             -- 属性标识符
    value       JSONB        NOT NULL,                              -- 属性值（JSONB以兼容多种数据类型）
    timestamp   TIMESTAMPTZ  NOT NULL DEFAULT NOW()                -- 上报时间
);

COMMENT ON TABLE  device_property_history IS '设备属性上报历史（时序数据）';

-- 时序查询复合索引：按设备+属性+时间范围
CREATE INDEX idx_prop_hist_device_id_ts ON device_property_history (device_id, identifier, timestamp DESC);

-- 可选：按月分区（数据量大时启用）
-- CREATE INDEX idx_prop_hist_ts ON device_property_history (timestamp DESC);

-- ============================================================
-- 8. 设备事件记录表 (Device Event Log)
-- 存储设备上报的事件记录
-- ============================================================
CREATE TABLE device_event_logs (
    id          BIGSERIAL   PRIMARY KEY,
    device_id   VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    event_id    VARCHAR(64)  NOT NULL,                             -- 事件标识符（对应物模型事件定义）
    event_type  VARCHAR(16)  NOT NULL DEFAULT 'info',              -- info | warn | error
    payload     JSONB        NOT NULL DEFAULT '{}',                -- 事件输出参数
    timestamp   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  device_event_logs IS '设备事件上报记录';

CREATE INDEX idx_event_logs_device_ts ON device_event_logs (device_id, timestamp DESC);
CREATE INDEX idx_event_logs_type     ON device_event_logs (event_type);

-- ============================================================
-- 9. 设备服务调用记录表 (Device Action Call Log)
-- 记录云端对设备下发的服务调用及设备响应
-- ============================================================
CREATE TABLE device_action_logs (
    id              BIGSERIAL   PRIMARY KEY,
    call_id         VARCHAR(64)  NOT NULL,                         -- 调用唯一ID（clientToken）
    device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    action_id       VARCHAR(64)  NOT NULL,                         -- 行为标识符
    input_params    JSONB        NOT NULL DEFAULT '{}',            -- 输入参数
    output_params   JSONB        NOT NULL DEFAULT '{}',            -- 设备响应输出参数
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',       -- pending | sent | success | failed | timeout
    error_code      VARCHAR(32),                                   -- 错误码
    error_msg       TEXT,                                          -- 错误信息
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    executed_at     TIMESTAMPTZ,                                    -- 设备响应时间
    timeout_at      TIMESTAMPTZ                                     -- 超时时间
);

COMMENT ON TABLE  device_action_logs IS '设备服务调用记录';

CREATE INDEX idx_action_logs_device_ts ON device_action_logs (device_id, created_at DESC);
CREATE INDEX idx_action_logs_status    ON device_action_logs (status);
CREATE INDEX idx_action_logs_call_id   ON device_action_logs (call_id);

-- ============================================================
-- 10. 自动更新 updated_at 触发器
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有需要的表挂载触发器
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'products', 'devices',
        'thing_model_properties', 'thing_model_events', 'thing_model_actions',
        'device_shadows'
    ]) LOOP
        EXECUTE format('
            CREATE TRIGGER set_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW
                EXECUTE FUNCTION trigger_set_updated_at();
        ', tbl);
    END LOOP;
END;
$$;

-- ============================================================
-- 11. 初始化示例数据
-- ============================================================

-- 插入示例产品
INSERT INTO products (product_id, product_name, category, protocol_type, network_type, data_protocol, auth_type, node_type, description) VALUES
('prod-a1b2c3d4', '智能温控器', '智能家电', 'MQTT', 'WiFi', 'MQTT-JSON', 'one-machine-one-secret', 'device', '支持温度采集与远程控温的智能恒温器'),
('prod-e5f6g7h8', '工业温湿度传感器', '工业传感', 'MQTT', 'Ethernet', 'MQTT-JSON', 'one-machine-one-secret', 'device', '工业级高精度温湿度采集传感器'),
('prod-i9j0k1l2', '智能网关', '网关设备', 'MQTT', 'Ethernet', 'MQTT-JSON', 'one-machine-one-secret', 'gateway', '支持ZigBee/BLE子设备接入的智能网关'),
('prod-m3n4o5p6', '智能照明灯', '智能家电', 'MQTT', 'WiFi', 'MQTT-JSON', 'one-machine-one-secret', 'device', '支持亮度/色温调节的智能LED灯');

-- 插入示例物模型属性（智能温控器）
INSERT INTO thing_model_properties (product_id, identifier, name, data_type, access_mode, description, spec, required, sort_order) VALUES
('prod-a1b2c3d4', 'temperature', '当前温度', 'float', 'rw', '设备当前温度读数', '{"min":-40,"max":85,"step":0.1,"unit":"°C","unitName":"摄氏度"}', true, 1),
('prod-a1b2c3d4', 'humidity', '当前湿度', 'float', 'r', '设备当前湿度读数', '{"min":0,"max":100,"step":0.1,"unit":"%","unitName":"百分比"}', true, 2),
('prod-a1b2c3d4', 'target_temperature', '目标温度', 'int', 'rw', '用户设定的目标温度', '{"min":16,"max":32,"step":1,"unit":"°C","unitName":"摄氏度"}', true, 3),
('prod-a1b2c3d4', 'power_switch', '电源开关', 'bool', 'rw', '设备电源开关', '{"0":"关","1":"开"}', true, 4),
('prod-a1b2c3d4', 'working_mode', '工作模式', 'enum', 'rw', '温控器工作模式', '{"enumList":[{"value":"auto","label":"自动"},{"value":"cool","label":"制冷"},{"value":"heat","label":"制热"},{"value":"fan","label":"送风"},{"value":"eco","label":"节能"}]}', true, 5),
('prod-a1b2c3d4', 'fan_speed', '风速', 'enum', 'rw', '风扇转速档位', '{"enumList":[{"value":"auto","label":"自动"},{"value":"low","label":"低"},{"value":"medium","label":"中"},{"value":"high","label":"高"}]}', false, 6),
('prod-a1b2c3d4', 'error_code', '故障码', 'int', 'r', '设备故障码，0表示正常', '{"min":0,"max":65535}', false, 7),
('prod-a1b2c3d4', 'voltage', '供电电压', 'float', 'r', '当前供电电压', '{"min":0,"max":300,"step":0.1,"unit":"V","unitName":"伏特"}', false, 8);

-- 插入示例物模型事件（智能温控器）
INSERT INTO thing_model_events (product_id, identifier, name, event_type, description, output_params) VALUES
('prod-a1b2c3d4', 'high_temperature_alarm', '高温告警', 'warn', '温度超过告警阈值时触发', '[{"identifier":"current_temp","name":"当前温度","dataType":"float","spec":{"unit":"°C"}},{"identifier":"threshold","name":"告警阈值","dataType":"float","spec":{"unit":"°C"}}]'),
('prod-a1b2c3d4', 'device_fault', '设备故障', 'error', '设备检测到硬件故障时触发', '[{"identifier":"error_code","name":"故障码","dataType":"int"},{"identifier":"error_msg","name":"故障描述","dataType":"string"}]'),
('prod-a1b2c3d4', 'firmware_update_ready', '固件更新就绪', 'info', '新固件下载完成，等待安装', '[{"identifier":"version","name":"新版本号","dataType":"string"},{"identifier":"size","name":"固件大小","dataType":"int","spec":{"unit":"KB"}}]');

-- 插入示例物模型行为（智能温控器）
INSERT INTO thing_model_actions (product_id, identifier, name, description, input_params, output_params, async_flag, call_strategy) VALUES
('prod-a1b2c3d4', 'set_temperature', '设置温度', '远程设置目标温度', '[{"identifier":"target_temp","name":"目标温度","dataType":"int","spec":{"min":16,"max":32}}]', '[]', false, 'direct'),
('prod-a1b2c3d4', 'reboot', '重启设备', '远程重启设备', '[]', '[{"identifier":"result","name":"执行结果","dataType":"bool"}]', true, 'direct'),
('prod-a1b2c3d4', 'set_mode', '设置模式', '切换工作模式', '[{"identifier":"mode","name":"工作模式","dataType":"enum","spec":{"enumList":[{"value":"auto","label":"自动"},{"value":"cool","label":"制冷"},{"value":"heat","label":"制热"},{"value":"fan","label":"送风"},{"value":"eco","label":"节能"}]}}]', '[]', false, 'direct');
