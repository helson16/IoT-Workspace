#!/usr/bin/env bash
# ============================================================
# IoT Explorer - 一键基础设施初始化脚本
# 用法: bash init-infra.sh [--stop | --reset]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
COMPOSE="docker compose"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ---------- 停止并清理 ----------
if [[ "${1:-}" == "--stop" ]]; then
  log_info "Stopping all infrastructure containers..."
  $COMPOSE --project-directory "$SCRIPT_DIR" down
  log_ok "Containers stopped."
  exit 0
fi

if [[ "${1:-}" == "--reset" ]]; then
  log_info "Removing containers, volumes, and all data..."
  $COMPOSE --project-directory "$SCRIPT_DIR" down -v
  log_ok "Everything removed."
  exit 0
fi

# ---------- 前置检查 ----------
log_info "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
  log_fail "Docker is not installed. Please install Docker first."
  exit 1
fi

if ! docker compose version &>/dev/null 2>&1; then
  if ! docker-compose version &>/dev/null 2>&1; then
    log_fail "Docker Compose is not available. Please install Docker Compose v2."
    exit 1
  fi
  COMPOSE="docker-compose"
fi

if ! docker info &>/dev/null 2>&1; then
  log_fail "Docker daemon is not running. Please start Docker."
  exit 1
fi

log_ok "Docker & Compose ready."

# ---------- Step 1: 拉起容器 ----------
log_info "Starting PostgreSQL, Redis, EMQX (docker compose up -d)..."
$COMPOSE --project-directory "$SCRIPT_DIR" up -d
log_ok "Containers starting."

# ---------- Step 2: 等待健康检查 ----------
log_info "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec iot-postgres pg_isready -U postgres -d iot_explorer &>/dev/null; then
    log_ok "PostgreSQL is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    log_fail "PostgreSQL did not become ready in 90s."
    exit 1
  fi
  sleep 3
done

log_info "Waiting for Redis to be ready..."
for i in $(seq 1 20); do
  if docker exec iot-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    log_ok "Redis is ready."
    break
  fi
  if [[ $i -eq 20 ]]; then
    log_fail "Redis did not become ready in 60s."
    exit 1
  fi
  sleep 3
done

log_info "Waiting for EMQX to be ready..."
for i in $(seq 1 30); do
  if docker exec iot-emqx emqx ping &>/dev/null; then
    log_ok "EMQX is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    log_fail "EMQX did not become ready in 150s."
    exit 1
  fi
  sleep 5
done

# ---------- Step 3: 数据库迁移 ----------
log_info "Running Prisma db push (schema migration)..."
cd "$BACKEND_DIR"
npx prisma db push --accept-data-loss 2>&1
log_ok "Database schema applied."

log_info "Generating Prisma Client..."
npx prisma generate 2>&1
log_ok "Prisma Client generated."

# ---------- Step 4: 汇总 ----------
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  IoT Explorer Infrastructure Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  PostgreSQL:  ${CYAN}localhost:5432${NC}  (postgres/postgres / iot_explorer)"
echo -e "  Redis:       ${CYAN}localhost:6379${NC}"
echo -e "  EMQX MQTT:   ${CYAN}localhost:1883${NC}  (TCP)"
echo -e "  EMQX SSL:    ${CYAN}localhost:8883${NC}  (TLS)"
echo -e "  EMQX WS:     ${CYAN}localhost:8083${NC}  (WebSocket)"
echo -e "  EMQX Dash:   ${CYAN}http://localhost:18083${NC}  (admin / public123)"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. cd backend && cp .env .env.local && npm run dev"
echo -e "  2. node tests/mock-device.js"
echo ""