import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams;
  const groupId = search.get("groupId");
  const type = search.get("type");
  const status = search.get("status");
  const searchQuery = search.get("search");
  const page = parseInt(search.get("page") || "1");
  const limit = parseInt(search.get("limit") || "20");

  const where: Record<string, unknown> = {};
  if (groupId) where.groupId = groupId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (searchQuery) {
    where.OR = [
      { name: { contains: searchQuery } },
      { description: { contains: searchQuery } },
      { location: { contains: searchQuery } },
    ];
  }

  const [devices, total] = await Promise.all([
    db.device.findMany({
      where,
      include: { group: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.device.count({ where }),
  ]);

  return NextResponse.json({
    devices,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, type, protocol, groupId, location, properties } = body;

  if (!name || !type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  const device = await db.device.create({
    data: {
      name,
      description: description || null,
      type,
      protocol: protocol || "MQTT",
      status: "offline",
      groupId: groupId || null,
      location: location || null,
      properties: JSON.stringify(properties || {}),
    },
    include: { group: true },
  });

  return NextResponse.json(device, { status: 201 });
}
