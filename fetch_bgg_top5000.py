import argparse
import csv
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

API_URL = "https://boardgamegeek.com/xmlapi2/thing"
BATCH_SIZE = 20
HANGUL_RE = re.compile(r"[\uac00-\ud7a3]")


def find_ranks_file(explicit_path: str | None) -> Path:
    if explicit_path:
        p = Path(explicit_path)
        if not p.exists():
            raise FileNotFoundError(f"지정한 파일을 찾을 수 없습니다: {p}")
        return p

    downloads = Path.home() / "Downloads"
    candidates = [
        Path.cwd() / "boardgames_ranks.csv",
        Path.cwd() / "boardgames_ranks.zip",
        downloads / "boardgames_ranks.csv",
        downloads / "boardgames_ranks.zip",
    ]
    for p in candidates:
        if p.exists():
            return p

    for folder in (Path.cwd(), downloads):
        if folder.exists():
            matches = sorted(
                folder.glob("*boardgame*rank*"),
                key=lambda x: x.stat().st_mtime,
                reverse=True,
            )
            if matches:
                return matches[0]

    raise FileNotFoundError(
        "boardgames_ranks.csv 또는 boardgames_ranks.zip 파일을 찾을 수 없습니다. "
        "--input 옵션으로 경로를 지정해 주세요."
    )


def load_top_ranks(ranks_path: Path, limit: int = 5000) -> list[dict]:
    def _read_csv_stream(f):
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            rank_str = (row.get("rank") or "").strip()
            if not rank_str.isdigit():
                continue
            rank_val = int(rank_str)
            if 1 <= rank_val <= limit:
                row["_rank_int"] = rank_val
                rows.append(row)
        rows.sort(key=lambda r: r["_rank_int"])
        return rows

    if ranks_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(ranks_path, "r") as zf:
            csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if not csv_names:
                raise ValueError(f"ZIP 파일 안에 CSV가 없습니다: {ranks_path}")
            with zf.open(csv_names[0], "r") as raw:
                import io
                return _read_csv_stream(io.TextIOWrapper(raw, encoding="utf-8-sig"))
    else:
        with open(ranks_path, "r", encoding="utf-8-sig", newline="") as f:
            return _read_csv_stream(f)


def fetch_batch_xml(ids: list[str], token: str, max_retries: int = 8) -> bytes:
    url = f"{API_URL}?id={','.join(ids)}&stats=1"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "BGGTop5000Collector/1.0",
        "Accept": "application/xml",
    }
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 202:
                    wait = min(2 + attempt * 2, 15)
                    time.sleep(wait)
                    continue
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (202, 429, 500, 502, 503, 504):
                wait = min(3 * (attempt + 1), 30)
                print(f"  [HTTP {e.code}] {wait}초 대기 후 재시도 ({attempt+1}/{max_retries})...", flush=True)
                time.sleep(wait)
                continue
            raise
        except Exception as e:
            wait = min(3 * (attempt + 1), 30)
            print(f"  [오류: {e}] {wait}초 대기 후 재시도 ({attempt+1}/{max_retries})...", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"최대 재시도 초과: ids={ids[:3]}...")


def parse_poll_numplayers(item: ET.Element) -> tuple[str, str]:
    poll = item.find("./poll[@name='suggested_numplayers']")
    if poll is None:
        return "", ""
    best_counts = []
    rec_counts = []
    for res in poll.findall("results"):
        numplayers = res.attrib.get("numplayers", "")
        votes = {}
        for r in res.findall("result"):
            val = r.attrib.get("value", "")
            cnt = int(r.attrib.get("numvotes", "0") or 0)
            votes[val] = cnt
        best_v = votes.get("Best", 0)
        rec_v = votes.get("Recommended", 0)
        not_v = votes.get("Not Recommended", 0)
        total = best_v + rec_v + not_v
        if total == 0:
            continue
        if best_v >= rec_v and best_v > not_v:
            best_counts.append(numplayers)
            rec_counts.append(numplayers)
        elif (best_v + rec_v) > not_v:
            rec_counts.append(numplayers)
    return ", ".join(best_counts), ", ".join(rec_counts)


def parse_top_poll_value(item: ET.Element, poll_name: str) -> str:
    poll = item.find(f"./poll[@name='{poll_name}']")
    if poll is None:
        return ""
    best_val = ""
    best_votes = -1
    for r in poll.findall(".//result"):
        cnt = int(r.attrib.get("numvotes", "0") or 0)
        if cnt > best_votes:
            best_votes = cnt
            best_val = r.attrib.get("value", "")
    return best_val if best_votes > 0 else ""


def parse_item(item: ET.Element) -> dict:
    item_id = item.attrib.get("id", "")
    item_type = item.attrib.get("type", "")

    primary_name = ""
    alt_names = []
    korean_names = []
    for n in item.findall("name"):
        val = n.attrib.get("value", "")
        if n.attrib.get("type") == "primary":
            primary_name = val
        else:
            alt_names.append(val)
            if HANGUL_RE.search(val):
                korean_names.append(val)

    def _attr(tag: str) -> str:
        el = item.find(tag)
        return el.attrib.get("value", "") if el is not None else ""

    def _text(tag: str) -> str:
        el = item.find(tag)
        return (el.text or "").strip() if el is not None else ""

    links_by_type: dict[str, list[str]] = {}
    for link in item.findall("link"):
        ltype = link.attrib.get("type", "")
        lval = link.attrib.get("value", "")
        if ltype and lval:
            links_by_type.setdefault(ltype, []).append(lval)

    best_players, rec_players = parse_poll_numplayers(item)
    suggested_age = parse_top_poll_value(item, "suggested_playerage")
    lang_dep = parse_top_poll_value(item, "language_dependence")

    ratings = item.find("./statistics/ratings")
    def _stat(tag: str) -> str:
        if ratings is None:
            return ""
        el = ratings.find(tag)
        return el.attrib.get("value", "") if el is not None else ""

    ranks_info = {}
    if ratings is not None:
        for r in ratings.findall("./ranks/rank"):
            rname = r.attrib.get("name", "")
            rval = r.attrib.get("value", "")
            if rname:
                ranks_info[rname] = rval

    desc_raw = _text("description")
    desc_clean = html.unescape(desc_raw).replace("\r\n", "\n").strip()

    return {
        "id": item_id,
        "type": item_type,
        "primary_name": primary_name,
        "korean_names": korean_names,
        "alternate_names_count": len(alt_names),
        "alternate_names": alt_names,
        "yearpublished": _attr("yearpublished"),
        "minplayers": _attr("minplayers"),
        "maxplayers": _attr("maxplayers"),
        "best_players": best_players,
        "recommended_players": rec_players,
        "playingtime": _attr("playingtime"),
        "minplaytime": _attr("minplaytime"),
        "maxplaytime": _attr("maxplaytime"),
        "minage": _attr("minage"),
        "suggested_playerage": suggested_age,
        "language_dependence": lang_dep,
        "thumbnail": _text("thumbnail"),
        "image": _text("image"),
        "categories": links_by_type.get("boardgamecategory", []),
        "mechanics": links_by_type.get("boardgamemechanic", []),
        "families": links_by_type.get("boardgamefamily", []),
        "designers": links_by_type.get("boardgamedesigner", []),
        "artists": links_by_type.get("boardgameartist", []),
        "publishers": links_by_type.get("boardgamepublisher", []),
        "implementations": links_by_type.get("boardgameimplementation", []),
        "expansions_count": len(links_by_type.get("boardgameexpansion", [])),
        "usersrated": _stat("usersrated"),
        "average": _stat("average"),
        "bayesaverage": _stat("bayesaverage"),
        "stddev": _stat("stddev"),
        "median": _stat("median"),
        "owned": _stat("owned"),
        "trading": _stat("trading"),
        "wanting": _stat("wanting"),
        "wishing": _stat("wishing"),
        "numcomments": _stat("numcomments"),
        "numweights": _stat("numweights"),
        "averageweight": _stat("averageweight"),
        "xml_ranks": ranks_info,
        "description": desc_clean,
    }


def main():
    parser = argparse.ArgumentParser(description="BGG Top 1~5000 상세정보 수집기")
    parser.add_argument("--input", "-i", help="boardgames_ranks.csv 또는 .zip 경로")
    parser.add_argument("--token", "-t", default=os.environ.get("BGG_API_TOKEN", ""), help="BGG XML API Bearer 토큰")
    parser.add_argument("--limit", "-l", type=int, default=5000, help="상위 몇 위까지 수집할지 (기본 5000)")
    parser.add_argument("--delay", "-d", type=float, default=0.6, help="배치 요청 간 대기 시간(초)")
    parser.add_argument("--outdir", "-o", default="output", help="결과 저장 폴더")
    args = parser.parse_args()

    if not args.token:
        print("오류: BGG API 토큰이 필요합니다 (--token 또는 BGG_API_TOKEN 환경변수).", file=sys.stderr)
        sys.exit(1)

    ranks_path = find_ranks_file(args.input)
    print(f"랭킹 파일 로드 중: {ranks_path}", flush=True)
    top_rows = load_top_ranks(ranks_path, limit=args.limit)
    print(f"추출된 게임 수: {len(top_rows)}개 (1~{args.limit}위)", flush=True)

    outdir = Path(args.outdir)
    cache_dir = outdir / "cache_xml"
    outdir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    items_by_id: dict[str, dict] = {}
    batches = [top_rows[i : i + BATCH_SIZE] for i in range(0, len(top_rows), BATCH_SIZE)]
    total_batches = len(batches)

    for idx, batch in enumerate(batches, 1):
        ids = [r["id"].strip() for r in batch]
        cache_file = cache_dir / f"batch_{idx:03d}_{ids[0]}_{ids[-1]}.xml"
        if cache_file.exists() and cache_file.stat().st_size > 100:
            xml_bytes = cache_file.read_bytes()
        else:
            xml_bytes = fetch_batch_xml(ids, args.token)
            cache_file.write_bytes(xml_bytes)
            time.sleep(args.delay)

        root = ET.fromstring(xml_bytes)
        for item_el in root.findall("item"):
            parsed = parse_item(item_el)
            items_by_id[parsed["id"]] = parsed

        if idx % 10 == 0 or idx == total_batches:
            print(f"진행률: {idx}/{total_batches} 배치 완료 ({len(items_by_id)}개 수집됨)", flush=True)

    merged_records = []
    for row in top_rows:
        gid = row["id"].strip()
        detail = items_by_id.get(gid, {})
        record = {
            "rank": row["_rank_int"],
            "id": gid,
            "csv_name": row.get("name", ""),
            "is_expansion": row.get("is_expansion", ""),
            "abstracts_rank": row.get("abstracts_rank", ""),
            "cgs_rank": row.get("cgs_rank", ""),
            "childrensgames_rank": row.get("childrensgames_rank", ""),
            "familygames_rank": row.get("familygames_rank", ""),
            "partygames_rank": row.get("partygames_rank", ""),
            "strategygames_rank": row.get("strategygames_rank", ""),
            "thematic_rank": row.get("thematic_rank", ""),
            "wargames_rank": row.get("wargames_rank", ""),
        }
        record.update(detail)
        merged_records.append(record)

    json_path = outdir / f"bgg_top{args.limit}_full.json"
    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(merged_records, jf, ensure_ascii=False, indent=2)

    csv_path = outdir / f"bgg_top{args.limit}_full.csv"
    csv_fields = [
        "rank", "id", "primary_name", "korean_names", "csv_name", "yearpublished",
        "minplayers", "maxplayers", "best_players", "recommended_players",
        "playingtime", "minplaytime", "maxplaytime", "minage", "suggested_playerage",
        "language_dependence", "averageweight", "numweights",
        "bayesaverage", "average", "usersrated", "stddev", "median",
        "owned", "trading", "wanting", "wishing", "numcomments",
        "categories", "mechanics", "families", "designers", "artists", "publishers",
        "implementations", "expansions_count",
        "is_expansion", "strategygames_rank", "thematic_rank", "familygames_rank",
        "partygames_rank", "wargames_rank", "abstracts_rank", "cgs_rank", "childrensgames_rank",
        "alternate_names_count", "alternate_names", "thumbnail", "image", "description",
    ]
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as cf:
        writer = csv.DictWriter(cf, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        for rec in merged_records:
            flat = dict(rec)
            for list_col in (
                "korean_names", "alternate_names", "categories", "mechanics",
                "families", "designers", "artists", "publishers", "implementations"
            ):
                val = flat.get(list_col, [])
                if isinstance(val, list):
                    flat[list_col] = " | ".join(val)
            writer.writerow(flat)

    print(f"\n완료! 저장된 파일:")
    print(f"  - CSV : {csv_path}")
    print(f"  - JSON: {json_path}")


if __name__ == "__main__":
    main()
