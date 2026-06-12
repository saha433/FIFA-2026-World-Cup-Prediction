from __future__ import annotations

import json
import ssl
from pathlib import Path
from urllib.request import Request, urlopen

import certifi


URL = "https://worldcup26.ir/get/games"
OUTPUT = Path(__file__).with_name("fixtures-fallback.json")


def main() -> None:
    request = Request(URL, headers={"User-Agent": "fifa26-dashboard/1.0"})
    context = ssl.create_default_context(cafile=certifi.where())
    with urlopen(request, timeout=20, context=context) as response:
        payload = json.load(response)
    games = payload.get("games", [])
    if len(games) != 104:
        raise RuntimeError(f"Expected 104 fixtures, received {len(games)}")
    OUTPUT.write_text(
        json.dumps({"games": games}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Saved {len(games)} fixtures to {OUTPUT}")


if __name__ == "__main__":
    main()
