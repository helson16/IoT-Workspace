import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const commands = await db.command.findMany({
    where: { deviceId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(commands);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { command, payload } = body;

  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }

  const cmd = await db.command.create({
    data: {
      deviceId: id,
      command,
      payload: payload ? JSON.stringify(payload) : null,
      status: "pending",
    },
  });

  // Simulate command execution after a short delay
  setTimeout(async () => {
    const success = Math.random() > 0.1;
    await db.command.update({
      where: { id: cmd.id },
      data: {
        status: success ? "success" : "failed",
        response: success ? JSON.stringify({ result: "ok" }) : JSON.stringify({ error: "timeout" }),
        executedAt: new Date(),
      },
    });
  }, 500 + Math.random() * 1500);

  return NextResponse.json(cmd, { status: 201 });
}