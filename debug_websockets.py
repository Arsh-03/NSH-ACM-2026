"""
Run: python debug_websocket.py
Shows exactly what the WebSocket is sending to the frontend
"""
import asyncio
import websockets
import json

async def check():
    uri = "ws://localhost:8000/ws"
    print(f"Connecting to {uri}...")
    
    async with websockets.connect(uri) as ws:
        # Get first message
        msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
        data = json.loads(msg)
        
        print(f"\n=== WebSocket payload ===")
        print(f"type:          {data.get('type')}")
        print(f"sat_count:     {data.get('sat_count')}")
        print(f"debris_count:  {data.get('debris_count')}")
        print(f"total:         {data.get('total')}")
        
        print(f"\n=== Satellites ({len(data.get('satellites',[]))}) ===")
        for s in data.get('satellites', []):
            print(f"  id={s['id']} | r={[round(x,1) for x in s['r']]} | fuel={s['fuel']}")
        
        print(f"\n=== Debris ({len(data.get('debris',[]))}) ===")
        for d in data.get('debris', [])[:5]:
            print(f"  id={d['id']} | r={[round(x,1) for x in d['r']]}")
        if len(data.get('debris',[])) > 5:
            print(f"  ... and {len(data['debris'])-5} more")

asyncio.run(check())