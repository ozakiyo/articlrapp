#!/usr/bin/env python3
"""G-FX 約定ログ + Yahoo Finance 5分足 → ローソク足チャート（売買マーカー付き）"""
import json
import re
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
OUT = __file__.replace("/scripts/generate-gfx-trade-chart.py", "/exports/gfx-trades-candlestick.html")

YAHOO = {
    "EUR/GBP": "EURGBP=X",
    "USD/CHF": "USDCHF=X",
    "USD/CAD": "USDCAD=X",
    "USD/JPY": "USDJPY=X",
    "EUR/USD": "EURUSD=X",
    "GBP/USD": "GBPUSD=X",
    "AUD/USD": "AUDUSD=X",
    "EUR/CHF": "EURCHF=X",
    "EUR/JPY": "EURJPY=X",
}

TRADE_RAW = """2026-06-09 9:48:18	USD/CHF	ショート新規	0.79803	2000	GFXレンジ上限ショート
2026-06-09 9:48:45	EUR/CHF	ショート新規	0.92016	2000	GFXレンジ上限ショート
2026-06-09 10:03:02	EUR/GBP	ショート新規	0.86465	2000	GFXレンジ上限ショート
2026-06-09 10:04:49	EUR/GBP	ショート決済	0.8646500111	2000	GFXショート利確(TP55%)
2026-06-09 10:08:01	EUR/GBP	ショート新規	0.86465	2000	GFXレンジ上限ショート
2026-06-09 10:13:04	EUR/GBP	ショート決済	0.864560008	2000	GFXショート利確(TP55%)
2026-06-09 21:23:00	EUR/USD	ロング決済	1.157407403	2000	GFXロング利確(TP55%)
2026-06-09 21:23:13	EUR/GBP	ロング新規	0.86334	2000	GFXレンジ下限ロング
2026-06-09 21:23:18	USD/CAD	ショート決済	1.39218998	2000	GFXショート利確(TP55%)
2026-06-09 21:23:23	GBP/USD	ロング決済	1.340105414	2000	GFXロング利確(TP55%)
2026-06-09 21:27:59	EUR/GBP	ロング決済	0.8633400202	2000	GFXロング利確(TP55%)
2026-06-09 21:33:00	EUR/GBP	ロング新規	0.86334	2000	GFXレンジ下限ロング
2026-06-09 21:39:43	EUR/GBP	ロング決済	0.8634499907	2000	GFXロング利確(TP55%)
2026-06-09 21:43:04	EUR/GBP	ロング新規	0.86345	2000	GFXレンジ下限ロング
2026-06-09 21:48:04	EUR/GBP	ロング決済	0.8634499907	2000	GFXロング利確(TP55%)
2026-06-09 21:53:04	EUR/GBP	ロング新規	0.86344	2000	GFXレンジ下限ロング
2026-06-09 21:58:02	EUR/GBP	ロング決済	0.8634399772	2000	GFXロング利確(TP55%)
2026-06-09 22:03:01	EUR/GBP	ロング新規	0.86344	2000	GFXレンジ下限ロング
2026-06-09 22:07:58	EUR/USD	ショート新規	1.15794	2000	GFXレンジ上限ショート
2026-06-09 22:08:03	USD/CHF	ショート決済	0.795509994	2000	GFXショート利確(TP55%)
2026-06-09 22:08:06	AUD/USD	ロング決済	0.7063144445	2000	GFXロング利確(TP55%)
2026-06-09 22:08:09	EUR/GBP	ロング決済	0.8636699915	2000	GFXロング利確(TP55%)
2026-06-09 22:08:14	EUR/JPY	ショート新規	185.426	2000	GFXレンジ上限ショート
2026-06-09 22:08:16	GBP/USD	ショート新規	1.34052	2000	GFXレンジ上限ショート
2026-06-09 22:19:40	EUR/GBP	ロング新規	0.86343	2000	GFXレンジ下限ロング
2026-06-09 22:23:40	EUR/GBP	ロング決済	0.8634300232	2000	GFXロング利確(TP55%)
2026-06-09 22:28:00	EUR/GBP	ロング新規	0.86343	2000	GFXレンジ下限ロング
2026-06-09 22:33:05	EUR/GBP	ロング決済	0.8633000255	2000	GFXロング利確(TP55%)
2026-06-09 22:38:06	EUR/GBP	ロング新規	0.8633	2000	GFXレンジ下限ロング
2026-06-09 22:42:59	EUR/GBP	ロング決済	0.8633000255	2000	GFXロング利確(TP55%)
2026-06-09 22:48:19	EUR/GBP	ロング新規	0.86324	2000	GFXレンジ下限ロング
2026-06-09 22:53:00	EUR/GBP	ロング決済	0.8632400036	2000	GFXロング利確(TP55%)
2026-06-09 22:58:01	EUR/GBP	ロング新規	0.86324	2000	GFXレンジ下限ロング
2026-06-09 23:03:09	EUR/GBP	ロング決済	0.8633300066	2000	GFXロング利確(TP55%)
2026-06-09 23:08:06	EUR/GBP	ロング新規	0.86333	2000	GFXレンジ下限ロング
2026-06-09 23:13:03	EUR/GBP	ロング決済	0.8633300066	2000	GFXロング利確(TP55%)
2026-06-09 23:18:12	EUR/GBP	ロング新規	0.86325	2000	GFXレンジ下限ロング
2026-06-09 23:18:18	USD/CAD	ショート新規	1.39481	2000	GFXレンジ上限ショート
2026-06-09 23:23:08	EUR/GBP	ロング決済	0.8632500172	2000	GFXロング利確(TP55%)
2026-06-09 23:23:14	USD/CAD	ショート決済	1.394809961	2000	GFXショート利確(TP55%)
2026-06-09 23:28:13	EUR/GBP	ロング新規	0.86309	2000	GFXレンジ下限ロング
2026-06-09 23:28:21	USD/CAD	ショート新規	1.39476	2000	GFXレンジ上限ショート
2026-06-09 23:33:27	USD/CAD	ショート決済	1.394760013	2000	GFXショート利確(TP55%)
2026-06-09 23:38:55	USD/CAD	ショート新規	1.39492	2000	GFXレンジ上限ショート
2026-06-09 23:53:04	AUD/USD	ロング新規	0.70378	2000	GFXレンジ下限ロング
2026-06-09 23:53:13	USD/CAD	ショート決済	1.394790053	2000	GFXショート利確(TP55%)
2026-06-09 23:58:07	USD/CAD	ショート新規	1.39479	2000	GFXレンジ上限ショート
2026-06-10 0:18:07	USD/CAD	ショート決済	1.394629955	2000	GFXショート利確(TP55%)
2026-06-10 0:23:04	USD/JPY	ショート新規	160.234	2000	GFXレンジ上限ショート
2026-06-10 0:27:58	USD/JPY	ショート決済	160.2339935	2000	GFXショート利確(TP55%)
2026-06-10 0:32:59	USD/JPY	ショート新規	160.283	2000	GFXレンジ上限ショート
2026-06-10 0:33:05	EUR/GBP	ロング決済	0.8634200096	2000	GFXロング利確(TP55%)
2026-06-10 0:33:07	USD/CAD	ショート新規	1.39563	2000	GFXレンジ上限ショート
2026-06-10 1:03:03	USD/JPY	ショート決済	160.2350006	2000	GFXショート利確(TP55%)
2026-06-10 1:03:13	EUR/GBP	ロング新規	0.86314	2000	GFXレンジ下限ロング
2026-06-10 1:28:00	EUR/USD	ショート決済	1.154734373	2000	GFXショート利確(TP55%)
2026-06-10 1:28:06	USD/JPY	ショート新規	160.334	2000	GFXレンジ上限ショート
2026-06-10 1:28:12	EUR/GBP	ロング決済	0.8631899953	2000	GFXロング利確(TP55%)
2026-06-10 1:33:55	USD/CHF	ショート新規	0.79802	2000	GFXレンジ上限ショート
2026-06-10 1:43:17	GBP/USD	ショート決済	1.335951805	2000	GFXショート利確(TP55%)
2026-06-10 1:48:00	EUR/GBP	ロング新規	0.86304	2000	GFXレンジ下限ロング
2026-06-10 2:28:01	USD/CHF	ショート決済	0.7974100113	2000	GFXショート利確(TP55%)
2026-06-10 2:53:09	USD/CAD	ショート決済	1.394899964	2000	GFXショート利確(TP55%)
2026-06-10 4:19:36	USD/CAD	ショート新規	1.39555	2000	GFXレンジ上限ショート
2026-06-10 4:28:04	USD/CHF	ショート新規	0.79857	2000	GFXレンジ上限ショート
2026-06-10 4:33:02	USD/CAD	ショート決済	1.394999981	2000	GFXショート利確(TP55%)
2026-06-10 6:03:03	USD/CHF	ショート決済	0.7972999811	2000	GFXショート利確(TP55%)
2026-06-10 6:03:09	EUR/GBP	ロング決済	0.8632400036	2000	GFXロング利確(TP55%)
2026-06-10 6:18:08	EUR/GBP	ロング新規	0.8627	2000	GFXレンジ下限ロング
2026-06-10 7:12:59	USD/CHF	ショート新規	0.79844	2000	GFXレンジ上限ショート"""


def parse_dt(s):
    s = re.sub(r"(\d{4}-\d{2}-\d{2}) (\d):", r"\1 0\2:", s)
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=JST)


def parse_trades(raw):
    out = []
    for line in raw.strip().split("\n"):
        dt, pair, action, price, size, reason = line.split("\t")
        is_long = "ロング" in action
        is_entry = "新規" in action
        out.append(
            {
                "time": parse_dt(dt),
                "unix": int(parse_dt(dt).timestamp()),
                "pair": pair,
                "action": action,
                "side": "long" if is_long else "short",
                "kind": "entry" if is_entry else "exit",
                "price": float(price),
                "reason": reason,
            }
        )
    return out


def fetch_candles(symbol, period1, period2):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?interval=5m&period1={period1}&period2={period2}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=30) as res:
        data = json.loads(res.read().decode())
    result = data["chart"]["result"][0]
    ts = result["timestamp"]
    q = result["indicators"]["quote"][0]
    candles = []
    for i, t in enumerate(ts):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if o is None or c is None:
            continue
        candles.append({"time": t, "open": o, "high": h, "low": l, "close": c})
    return candles


def trade_marker(t):
    if t["kind"] == "entry" and t["side"] == "long":
        return {
            "time": t["unix"],
            "position": "belowBar",
            "color": "#22c55e",
            "shape": "arrowUp",
            "text": f"L入 {t['price']:.5f}",
        }
    if t["kind"] == "entry" and t["side"] == "short":
        return {
            "time": t["unix"],
            "position": "aboveBar",
            "color": "#ef4444",
            "shape": "arrowDown",
            "text": f"S入 {t['price']:.5f}",
        }
    if t["side"] == "long":
        return {
            "time": t["unix"],
            "position": "aboveBar",
            "color": "#86efac",
            "shape": "circle",
            "text": f"L決 {t['price']:.5f}",
        }
    return {
        "time": t["unix"],
        "position": "belowBar",
        "color": "#fca5a5",
        "shape": "circle",
        "text": f"S決 {t['price']:.5f}",
    }


def main():
    trades = parse_trades(TRADE_RAW)
    t_min = min(t["time"] for t in trades)
    t_max = max(t["time"] for t in trades)
    period1 = int((t_min - timedelta(hours=2)).timestamp())
    period2 = int((t_max + timedelta(hours=2)).timestamp())

    pairs = sorted({t["pair"] for t in trades}, key=lambda p: -sum(1 for x in trades if x["pair"] == p))
    bundle = {}
    for pair in pairs:
        sym = YAHOO.get(pair)
        if not sym:
            continue
        print(f"fetch {pair} ({sym})...")
        candles = fetch_candles(sym, period1, period2)
        markers = [trade_marker(t) for t in trades if t["pair"] == pair]
        markers.sort(key=lambda m: m["time"])
        bundle[pair] = {"candles": candles, "markers": markers}
        print(f"  candles={len(candles)} markers={len(markers)}")

    html = build_html(bundle, pairs, t_min, t_max)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"written: {OUT}")


def build_html(bundle, pairs, t_min, t_max):
    data_json = json.dumps(bundle, ensure_ascii=False)
    pairs_json = json.dumps(pairs, ensure_ascii=False)
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>G-FX 売買ポイント — ローソク足チャート</title>
<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>
<style>
body {{ margin:0; font-family:system-ui,sans-serif; background:#0b0f14; color:#e2e8f0; }}
header {{ padding:12px 16px; border-bottom:1px solid #1e293b; }}
h1 {{ margin:0; font-size:1.1rem; }}
.sub {{ color:#94a3b8; font-size:0.8rem; margin-top:4px; }}
.toolbar {{ padding:8px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }}
select {{ background:#1e293b; color:#e2e8f0; border:1px solid #334155; border-radius:6px; padding:6px 10px; }}
.legend {{ font-size:0.75rem; color:#94a3b8; }}
.legend span {{ margin-right:12px; }}
.legend .g {{ color:#22c55e; }} .legend .r {{ color:#ef4444; }}
#chart {{ width:100%; height:calc(100vh - 120px); }}
</style>
</head>
<body>
<header>
  <h1>G-FX 売買ポイント — 実足チャート（Yahoo Finance 5分足）</h1>
  <p class="sub">{t_min.strftime('%Y-%m-%d %H:%M')} 〜 {t_max.strftime('%Y-%m-%d %H:%M')} JST</p>
</header>
<div class="toolbar">
  <label>通貨ペア <select id="pairSel"></select></label>
  <div class="legend">
    <span class="g">▲ ロング新規</span>
    <span class="r">▼ ショート新規</span>
    <span class="g">○ ロング決済</span>
    <span class="r">○ ショート決済</span>
  </div>
</div>
<div id="chart"></div>
<script>
const BUNDLE = {data_json};
const PAIRS = {pairs_json};
const el = document.getElementById('chart');
const chart = LightweightCharts.createChart(el, {{
  layout: {{ background: {{ color: '#0b0f14' }}, textColor: '#94a3b8' }},
  grid: {{ vertLines: {{ color: '#1e293b' }}, horzLines: {{ color: '#1e293b' }} }},
  timeScale: {{ timeVisible: true, secondsVisible: false, borderColor: '#334155' }},
  rightPriceScale: {{ borderColor: '#334155' }},
  crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }},
}});
const series = chart.addCandlestickSeries({{
  upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
}});
const sel = document.getElementById('pairSel');
PAIRS.forEach(p => {{
  const o = document.createElement('option');
  o.value = p; o.textContent = p + ' (' + (BUNDLE[p]?.markers?.length||0) + '約定)';
  sel.appendChild(o);
}});
function showPair(pair) {{
  const b = BUNDLE[pair];
  if (!b) return;
  series.setData(b.candles);
  series.setMarkers(b.markers);
  chart.timeScale().fitContent();
}}
sel.addEventListener('change', () => showPair(sel.value));
showPair(PAIRS[0]);
window.addEventListener('resize', () => chart.applyOptions({{ width: el.clientWidth }}));
</script>
</body>
</html>"""


if __name__ == "__main__":
    main()
