import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const device = await db.device.findUnique({
    where: { id },
    include: { group: true, telemetry: { take: 1, orderBy: { timestamp: "desc" } } },
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  return NextResponse.json(device);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const device = await db.device.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.protocol !== undefined && { protocol: body.protocol }),
      ...(body.location !== undefined && { location: body.location }),
      ...(body.groupId !== undefined && { groupId: body.groupId || null }),
      ...(body.properties !== undefined && { properties: JSON.stringify(body.properties) }),
    },
    include: { group: true },
  });
  return NextResponse.json(device);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.device.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
