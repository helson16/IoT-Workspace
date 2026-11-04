# IoT Explorer - Harness-style task runner
# Usage: just <recipe>

set shell := ["bash", "-c"]

# List all available recipes
default:
    @just --list

# Full setup: install deps + push DB + seed
tool setup:
    @echo "==> Installing dependencies..."
    bun install
    @echo "==> Syncing database..."
    just db-push
    @echo "==> Seeding data..."
    just seed
    @echo "==> Setup complete!"

# Push Prisma schema to DB
tool db-push:
    bun run db:push

# Generate Prisma client
tool db-generate:
    bun run db:generate

# Seed database with demo data
tool seed:
    bun run prisma/seed/seed.ts

# Run linting
tool lint:
    bun run lint

# Start MQTT WebSocket service
tool mqtt:
    cd mini-services/mqtt-service && bun --hot index.ts

# Reset database
tool db-reset:
    rm -f db/custom.db
    just db-push
    just seed

# Show database stats
tool db-stats:
    @echo "==> Device count:"
    @echo "SELECT COUNT(*) FROM Device;" | sqlite3 db/custom.db
    @echo "==> Telemetry points:"
    @echo "SELECT COUNT(*) FROM Telemetry;" | sqlite3 db/custom.db
