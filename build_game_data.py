"""Build lightweight game data (web/data/games.js) from boardlife_details.csv and output/bgg_top5000_full.json."""

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

HANGUL_RE = re.compile(r"[\uac00-\ud7a3]")
BGG_ID_RE = re.compile(r"/boardgame/(\d+)")
RANGE_RE = re.compile(r"(\d+)\s*[-~]\s*(\d+)")
NUM_RE = re.compile(r"(\d+(?:\.\d+)?)")

CHO_LIST = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG_LIST = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG_LIST = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]


def _compose_hangul(cho: str, jung: str, jong: str = "") -> str:
    ci = CHO_LIST.index(cho)
    ji = JUNG_LIST.index(jung)
    ki = JONG_LIST.index(jong) if jong in JONG_LIST else 0
    return chr(0xAC00 + (ci * 21 + ji) * 28 + ki)


def transliterate_en_to_kr(text: str) -> str:
    """Lightweight English-to-Hangul phonetic transliterator for search aliases."""
    words = re.findall(r"[a-zA-Z]+", (text or "").lower())
    if not words:
        return ""

    vowels_map = [
        ("oo", "ㅜ"), ("ee", "ㅣ"), ("ea", "ㅣ"), ("ai", "ㅔ"), ("ay", "ㅔ"),
        ("oa", "ㅗ"), ("ow", "ㅗ"), ("ou", "ㅏ"), ("au", "ㅗ"), ("aw", "ㅗ"),
        ("oi", "ㅗ"), ("oy", "ㅗ"), ("ie", "ㅣ"), ("ei", "ㅔ"),
        ("a", "ㅏ"), ("e", "ㅔ"), ("i", "ㅣ"), ("o", "ㅗ"), ("u", "ㅜ"), ("y", "ㅣ"),
    ]
    cons_map = [
        ("tch", "ㅊ"), ("sh", "ㅅ"), ("ch", "ㅊ"), ("th", "ㅅ"), ("ph", "ㅍ"),
        ("ck", "ㅋ"), ("qu", "ㅋ"), ("wh", "ㅇ"), ("ng", "ㅇ"),
        ("b", "ㅂ"), ("c", "ㅋ"), ("d", "ㄷ"), ("f", "ㅍ"), ("g", "ㄱ"),
        ("h", "ㅎ"), ("j", "ㅈ"), ("k", "ㅋ"), ("l", "ㄹ"), ("m", "ㅁ"),
        ("n", "ㄴ"), ("p", "ㅍ"), ("q", "ㅋ"), ("r", "ㄹ"), ("s", "ㅅ"),
        ("t", "ㅌ"), ("v", "ㅂ"), ("w", "ㅇ"), ("x", "ㅋ"), ("z", "ㅈ"),
    ]
    coda_ok = {"ㄱ", "ㄴ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ"}

    out_words: list[str] = []
    for w in words:
        tokens: list[tuple[str, str]] = []
        i = 0
        while i < len(w):
            matched = False
            for pat, val in vowels_map:
                if w.startswith(pat, i):
                    tokens.append(("V", val))
                    i += len(pat)
                    matched = True
                    break
            if matched:
                continue
            # soft c/g before e, i, y
            if w[i] == "c" and i + 1 < len(w) and w[i + 1] in "eiy":
                tokens.append(("C", "ㅅ"))
                i += 1
                continue
            if w[i] == "g" and i + 1 < len(w) and w[i + 1] in "eiy":
                tokens.append(("C", "ㅈ"))
                i += 1
                continue
            for pat, val in cons_map:
                if w.startswith(pat, i):
                    tokens.append(("C", val))
                    i += len(pat)
                    matched = True
                    break
            if not matched:
                i += 1

        res: list[str] = []
        idx = 0
        while idx < len(tokens):
            t_type, val = tokens[idx]
            if t_type == "V":
                cho = "ㅇ"
                jung = val
                idx += 1
            else:
                cho = val
                if idx + 1 < len(tokens) and tokens[idx + 1][0] == "V":
                    jung = tokens[idx + 1][1]
                    idx += 2
                else:
                    jung = "ㅡ"
                    idx += 1

            jong = ""
            if (
                idx < len(tokens)
                and tokens[idx][0] == "C"
                and tokens[idx][1] in coda_ok
                and (idx + 1 >= len(tokens) or tokens[idx + 1][0] == "C")
            ):
                jong = tokens[idx][1]
                idx += 1

            res.append(_compose_hangul(cho, jung, jong))
        out_words.append("".join(res))

    return "".join(out_words)


def parse_range(text: str) -> tuple[int | None, int | None]:
    """Parse '2-4명' or '60분' into (min_val, max_val)."""
    if not text:
        return None, None
    m = RANGE_RE.search(text)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        return min(lo, hi), max(lo, hi)
    m = NUM_RE.search(text)
    if m:
        val = int(float(m.group(1)))
        return val, val
    return None, None


def parse_difficulty(text: str) -> float | None:
    """Parse '3.72 / 5' into 3.72."""
    if not text:
        return None
    m = NUM_RE.search(text)
    return round(float(m.group(1)), 2) if m else None


def split_tags(text: str) -> list[str]:
    """Split comma-separated tags and deduplicate while preserving order."""
    if not text:
        return []
    seen = set()
    result = []
    for part in text.split(","):
        tag = part.strip()
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def to_int(val) -> int | None:
    s = str(val or "").strip()
    if s.isdigit():
        return int(s)
    try:
        f = float(s)
        return int(round(f)) if f > 0 else None
    except ValueError:
        return None


def to_float(val) -> float | None:
    try:
        f = float(str(val or "").strip())
        return round(f, 2) if f > 0 else None
    except ValueError:
        return None


def learn_tag_mapping(
    overlap_pairs: list[tuple[list[str], list[str]]]
) -> dict[str, str]:
    """Learn English -> Korean tag mapping from overlapping BoardLife & BGG games."""
    en_counts: Counter[str] = Counter()
    cooccur: dict[str, Counter[str]] = defaultdict(Counter)

    for en_tags, kr_tags in overlap_pairs:
        if not en_tags or not kr_tags:
            continue
        for et in en_tags:
            en_counts[et] += 1
            for kt in kr_tags:
                cooccur[et][kt] += 1

    mapping: dict[str, str] = {}
    for et, total in en_counts.items():
        if total < 2:
            continue
        best_kt, best_cnt = cooccur[et].most_common(1)[0]
        if best_cnt >= 2 and (best_cnt / total) >= 0.3:
            mapping[et] = best_kt
    return mapping


def translate_tags(en_tags: list[str], mapping: dict[str, str]) -> list[str]:
    seen = set()
    out = []
    for t in en_tags:
        mapped = mapping.get(t)
        if mapped and mapped not in seen:
            seen.add(mapped)
            out.append(mapped)
    return out


def build_games(bl_csv: Path, bgg_json: Path) -> tuple[list[dict], dict]:
    bgg_items = json.loads(bgg_json.read_text(encoding="utf-8"))
    bgg_by_id: dict[str, dict] = {str(item["id"]): item for item in bgg_items}

    games: list[dict] = []
    seen_bgg_ids: set[str] = set()
    mech_pairs: list[tuple[list[str], list[str]]] = []
    theme_pairs: list[tuple[list[str], list[str]]] = []

    with open(bl_csv, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rank_str = (row.get("rank") or "").strip()
            year_str = (row.get("year") or "").strip()
            if not rank_str.isdigit() or not year_str.isdigit():
                continue

            rank = int(rank_str)
            year = int(year_str)
            difficulty = parse_difficulty(row.get("difficulty", ""))
            min_p, max_p = parse_range(row.get("players", ""))
            min_t, max_t = parse_range(row.get("playtime", ""))

            if difficulty is None or min_p is None or max_p is None or min_t is None or max_t is None:
                continue

            bgg_url = (row.get("bgg_url") or "").strip()
            bgg_match = BGG_ID_RE.search(bgg_url)
            bgg_id = bgg_match.group(1) if bgg_match else ""
            bgg_item = bgg_by_id.get(bgg_id)
            if bgg_id:
                seen_bgg_ids.add(bgg_id)

            title_kr = (row.get("title_kr") or "").strip()
            title_en = (row.get("title_en") or "").strip()
            if not HANGUL_RE.search(title_kr) and bgg_item and bgg_item.get("korean_names"):
                title_kr = bgg_item["korean_names"][0]

            has_kr = bool(HANGUL_RE.search(title_kr))
            display_kr = title_kr if title_kr else title_en
            display_en = title_en if display_en_differs(display_kr, title_en) else ""

            bl_mech = split_tags(row.get("mechanisms", ""))
            bl_theme = split_tags(row.get("themes", ""))
            if bgg_item:
                mech_pairs.append((bgg_item.get("mechanics", []), bl_mech))
                theme_pairs.append((bgg_item.get("categories", []), bl_theme))

            thumb = (bgg_item.get("thumbnail") or "").strip() if bgg_item else ""

            games.append({
                "id": int(row["game_id"]) if (row.get("game_id") or "").isdigit() else rank,
                "rank": rank,
                "blRank": rank,
                "bggRank": (to_int(bgg_item.get("rank")) or 99999) if bgg_item else 99999,
                "partyRank": (to_int(bgg_item.get("partygames_rank")) or 99999) if bgg_item else 99999,
                "familyRank": (to_int(bgg_item.get("familygames_rank")) or 99999) if bgg_item else 99999,
                "kr": display_kr,
                "en": display_en,
                "hasKr": has_kr,
                "year": year,
                "diff": difficulty,
                "minP": min_p,
                "maxP": max_p,
                "timeStr": (row.get("playtime") or "").strip(),
                "minT": min_t,
                "maxT": max_t,
                "mech": bl_mech,
                "theme": bl_theme,
                "designer": (row.get("designer") or "").strip(),
                "url": (row.get("url") or "").strip(),
                "thumb": thumb,
            })

    mech_map = learn_tag_mapping(mech_pairs)
    theme_map = learn_tag_mapping(theme_pairs)

    bgg_added = 0
    for item in bgg_items:
        bgg_id = str(item.get("id", "")).strip()
        if not bgg_id or bgg_id in seen_bgg_ids:
            continue
        if str(item.get("is_expansion", "0")).strip() == "1":
            continue

        year = to_int(item.get("yearpublished"))
        diff = to_float(item.get("averageweight"))
        min_p = to_int(item.get("minplayers"))
        max_p = to_int(item.get("maxplayers"))
        min_t = to_int(item.get("minplaytime")) or to_int(item.get("playingtime"))
        max_t = to_int(item.get("maxplaytime")) or to_int(item.get("playingtime"))

        if not year or diff is None or not min_p or not max_p or not min_t or not max_t:
            continue
        if min_p > max_p:
            min_p, max_p = max_p, min_p
        if min_t > max_t:
            min_t, max_t = max_t, min_t

        kr_names = item.get("korean_names") or []
        primary = (item.get("primary_name") or "").strip()
        has_kr = bool(kr_names and HANGUL_RE.search(kr_names[0]))
        display_kr = kr_names[0].strip() if has_kr else primary
        if not display_kr:
            continue
        display_en = primary if has_kr and primary != display_kr else ""

        time_str = f"{min_t}분" if min_t == max_t else f"{min_t}-{max_t}분"
        bgg_rank = to_int(item.get("rank")) or 5000

        games.append({
            "id": 1000000 + int(bgg_id),
            "rank": 10000 + bgg_rank,
            "blRank": 99999,
            "bggRank": bgg_rank,
            "partyRank": to_int(item.get("partygames_rank")) or 99999,
            "familyRank": to_int(item.get("familygames_rank")) or 99999,
            "kr": display_kr,
            "en": display_en,
            "sk": "" if has_kr else transliterate_en_to_kr(display_kr),
            "hasKr": has_kr,
            "year": year,
            "diff": diff,
            "minP": min_p,
            "maxP": max_p,
            "timeStr": time_str,
            "minT": min_t,
            "maxT": max_t,
            "mech": translate_tags(item.get("mechanics", []), mech_map),
            "theme": translate_tags(item.get("categories", []), theme_map),
            "designer": ", ".join(item.get("designers", [])[:3]),
            "url": f"https://boardgamegeek.com/boardgame/{bgg_id}",
            "thumb": (item.get("thumbnail") or "").strip(),
        })
        bgg_added += 1

    games.sort(key=lambda g: g["rank"])
    stats = {
        "total": len(games),
        "bgg_added": bgg_added,
        "has_kr": sum(1 for g in games if g["hasKr"]),
        "has_thumb": sum(1 for g in games if g["thumb"]),
        "mech_mapped": len(mech_map),
        "theme_mapped": len(theme_map),
    }
    return games, stats


def display_en_differs(kr: str, en: str) -> bool:
    return bool(en and kr.lower() != en.lower())


def main() -> None:
    root = Path(__file__).resolve().parent
    bl_csv = root / "boardlife_details.csv"
    bgg_json = root / "output" / "bgg_top5000_full.json"
    out_path = root / "web" / "data" / "games.js"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    games, stats = build_games(bl_csv, bgg_json)
    payload = "window.BGG_GAMES = " + json.dumps(games, ensure_ascii=False, separators=(",", ":")) + ";\n"
    out_path.write_text(payload, encoding="utf-8")

    print(f"Generated {out_path}")
    print(
        f"Total: {stats['total']} (BGG added: {stats['bgg_added']}) | "
        f"Korean titles: {stats['has_kr']} | Thumbnails: {stats['has_thumb']} | "
        f"Tag maps (mech/theme): {stats['mech_mapped']}/{stats['theme_mapped']}"
    )


if __name__ == "__main__":
    main()
