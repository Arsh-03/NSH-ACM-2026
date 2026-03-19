import asyncio, websockets, json

async def check():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        msg  = await asyncio.wait_for(ws.recv(), timeout=5.0)
        data = json.loads(msg)
        print(f"sat_count:    {data.get('sat_count')}")
        print(f"debris_count: {data.get('debris_count')}")
        print(f"total:        {data.get('total')}")
        print(f"Satellites:")
        for s in data.get('satellites', []):
            print(f"  {s['id']} | r={[round(x,1) for x in s['r']]}")
        print(f"Debris (first 3):")
        for d in data.get('debris', [])[:3]:
            print(f"  {d['id']} | r={[round(x,1) for x in d['r']]}")

asyncio.run(check())
