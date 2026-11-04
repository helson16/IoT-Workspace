import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const groups = await db.deviceGroup.findMany({
    include: { _count: { select: { devices: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, color } = body;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const group = await db.deviceGroup.create({
    data: { name, description: description || null, color: color || "#6366f1" },
    include: { _count: { select: { devices: true } } },
  });
  return NextResponse.json(group, { status: 201 });
}