import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const alert = await db.alert.update({
    where: { id },
    data: { acknowledged: true },
  });
  return NextResponse.json(alert);
}