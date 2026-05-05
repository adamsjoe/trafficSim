import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.text();

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'TrafficSim/1.0',
      'Accept':       '*/*',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Overpass ${res.status}: ${text.slice(0, 200)}` }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
