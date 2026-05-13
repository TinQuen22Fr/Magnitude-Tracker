"""POC test for core SQM ingestion.

Validates:
  1. Auth: bad key -> 401, good key -> 200
  2. Concurrency: 50 parallel POSTs -> JSON file remains valid + count correct
  3. /latest and /history endpoints work
  4. /stats endpoint returns valid stats

Run: python /app/backend/test_core.py
"""
import asyncio
import json
import os
import random
import sys
from pathlib import Path
import httpx

BASE = os.environ.get('TEST_BASE', 'http://localhost:8001')
HISTORY_FILE = Path('/app/backend/sqm_history.json')
ENV_FILE = Path('/app/backend/.env')


def get_api_key() -> str:
    # Read from .env
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith('SQM_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise RuntimeError('SQM_API_KEY not found in .env')


async def main():
    api_key = get_api_key()
    print(f'[POC] Using API key: {api_key[:8]}...')

    # Reset history file for clean test
    HISTORY_FILE.write_text('[]')
    print(f'[POC] History file reset: {HISTORY_FILE}')

    async with httpx.AsyncClient(base_url=BASE, timeout=20.0) as client:
        # 1) Auth check: bad key
        r = await client.post('/api/sqm_push', json={'mag': 21.0, 'lux': 0.001, 'temp': 12.0},
                              headers={'X-API-Key': 'WRONG'})
        assert r.status_code == 401, f'Expected 401, got {r.status_code}'
        print('[OK] Bad key -> 401')

        # 2) Auth check: missing key
        r = await client.post('/api/sqm_push', json={'mag': 21.0, 'lux': 0.001, 'temp': 12.0})
        assert r.status_code == 401, f'Expected 401 for missing key, got {r.status_code}'
        print('[OK] Missing key -> 401')

        # 3) Single push with good key
        r = await client.post('/api/sqm_push', json={'mag': 21.34, 'lux': 0.0008, 'temp': 12.5},
                              headers={'X-API-Key': api_key})
        assert r.status_code == 200, f'Expected 200, got {r.status_code}: {r.text}'
        body = r.json()
        assert body['status'] == 'ok'
        print(f"[OK] Single push -> 200, total={body['total']}")

        # 4) CONCURRENCY TEST: 50 parallel POSTs
        N = 50

        async def push_one(i):
            payload = {
                'mag': round(20.0 + random.random() * 2, 3),
                'lux': round(random.random() * 0.01, 6),
                'temp': round(5.0 + random.random() * 20, 2),
            }
            return await client.post('/api/sqm_push', json=payload,
                                     headers={'X-API-Key': api_key})

        results = await asyncio.gather(*[push_one(i) for i in range(N)])
        ok_count = sum(1 for r in results if r.status_code == 200)
        assert ok_count == N, f'Expected {N} successes, got {ok_count}'
        print(f'[OK] {N} concurrent pushes all returned 200')

        # 5) Verify file integrity
        content = HISTORY_FILE.read_text()
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            print(f'[FAIL] JSON corrupted: {e}')
            sys.exit(1)
        assert isinstance(data, list), 'History must be a list'
        # We expect 1 (single push) + N (concurrent) = 51 records
        expected = 1 + N
        assert len(data) == expected, f'Expected {expected} records, got {len(data)}'
        print(f'[OK] JSON integrity: {len(data)} records, file valid')

        # 6) /latest
        r = await client.get('/api/sqm/latest')
        assert r.status_code == 200
        body = r.json()
        assert body['data'] is not None
        assert body['count'] == expected
        print(f"[OK] /latest returned valid record (count={body['count']})")

        # 7) /history
        r = await client.get('/api/sqm/history')
        assert r.status_code == 200
        body = r.json()
        assert body['count'] == expected
        print(f"[OK] /history returned {body['count']} records")

        # 8) /history with limit
        r = await client.get('/api/sqm/history?limit=5')
        body = r.json()
        assert body['count'] == 5
        print('[OK] /history?limit=5 returned 5 records')

        # 9) /stats
        r = await client.get('/api/sqm/stats')
        assert r.status_code == 200
        s = r.json()
        assert s['count'] == expected
        assert s['mag']['min'] is not None
        print(
            f"[OK] /stats: count={s['count']}, mag.min={s['mag']['min']:.2f}, "
            f"mag.max={s['mag']['max']:.2f}, mag.avg={s['mag']['avg']:.2f}"
        )

        # 10) Validation: out-of-range mag
        r = await client.post('/api/sqm_push', json={'mag': 99.0, 'lux': 0.001, 'temp': 12.0},
                              headers={'X-API-Key': api_key})
        assert r.status_code == 422, f'Expected 422 for invalid mag, got {r.status_code}'
        print('[OK] Validation rejects out-of-range mag (422)')

    print('\n=== ALL POC TESTS PASSED ===')


if __name__ == '__main__':
    asyncio.run(main())
