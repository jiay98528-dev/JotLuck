# -*- coding: utf-8 -*-
"""JotLuck × Reink-1.0 桥接脚本（本文件由 reink_engine.rs include_str! 内嵌并落盘执行）。

环境要求：Python ≥ 3.9，且运行环境内已安装 torch / sentencepiece / numpy。
运行包与依赖说明见 doc/reink-runtime-requirements.md。

红线声明：
  1. 运行包（--runtime 指向的 reink-runtime-1.0 目录）内一切文件只读，
     本脚本绝不写入、热修或改写包内任何文件；升级运行包 = 整包替换。
  2. 快速档只通过包外属性赋值实现：
     suggestion_generator.N_CAND = 8 / MAX_NEW = 3（质量档还原 24 / 4），
     调用时读取的是模块属性，禁止改包内文件。

协议（JSON 行，UTF-8）：
  请求（stdin，每行一个）：
    {"id": 0,                    }  # 保留：启动完成帧由脚本主动发（见下）
    {"id": N, "op": "configure", "fast": bool}
    {"id": N, "op": "warmup",    "tier": "32m"|"64m"}
    {"id": N, "op": "generate",  "prefix": str, "lang": "zh"|"en", "n": int, "tier": "32m"|"64m"}
    {"id": N, "op": "shutdown"}
  响应（stdout，每行一个）：
    {"id": N, "ok": true,  "data": {...}}
    {"id": N, "ok": false, "error": "..."}
  启动时 import 成功后先发一帧 {"id": 0, "ok": true, "data": {"bridge": "reink", "version": 1}}。
  stderr 只打诊断日志；stdout 只出协议行（导入期 torch/sentencepiece 的
  杂散输出会被整体重定向到 stderr，协议走独立保存的 fd）。

模型非线程安全：本脚本单线程串行处理请求（stdin 逐行循环），宿主侧无需加锁
即可按 FIFO 语义获得串行推理。读到 EOF 即退出；单个请求异常只回错误帧，不崩进程。
"""

import json
import math
import os
import sys
import time

# 只读纪律双保险：宿主会设 PYTHONDONTWRITEBYTECODE=1，这里再置一次模块开关，
# 防止有人手工运行本脚本时在运行包目录里生成 __pycache__。
sys.dont_write_bytecode = True

FAST_N_CAND = 8
FAST_MAX_NEW = 3
QUALITY_N_CAND = 24
QUALITY_MAX_NEW = 4
BRIDGE_VERSION = 1
MAX_CANDIDATES = 8


def eprint(*args):
    print(*args, file=sys.stderr, flush=True)


def parse_runtime_arg():
    """解析 --runtime <运行包目录>；缺参/多余参数直接报错退出。"""
    args = sys.argv[1:]
    if len(args) != 2 or args[0] != "--runtime":
        raise SystemExit("usage: reink_bridge.py --runtime <reink-runtime-dir>")
    return args[1]


def open_protocol_stream():
    """保存真实 stdout 的 fd，并把 fd 1 整体重定向到 stderr。

    导入 torch/sentencepiece 期间，任何 C 层或 Python 层写向 stdout 的
    杂散输出（警告、横幅、进度条）都会落到 stderr；协议帧通过保留下来的
    fd 写出，保证 stdout 上只有协议行。
    """
    try:
        protocol_fd = os.dup(1)
    except OSError as exc:
        raise SystemExit("reink bridge: unable to reserve stdout fd: {0}".format(exc))
    try:
        os.dup2(2, 1)
    except OSError as exc:
        raise SystemExit("reink bridge: unable to redirect stdout to stderr: {0}".format(exc))
    sys.stdout = sys.stderr
    return os.fdopen(protocol_fd, "w", encoding="utf-8", buffering=1)


def import_runtime(runtime_dir):
    """sys.path 注入运行包并 import suggestion_generator（只读，不写任何文件）。"""
    if not os.path.isdir(runtime_dir):
        raise RuntimeError("reink runtime directory not found: {0}".format(runtime_dir))
    if runtime_dir not in sys.path:
        sys.path.insert(0, runtime_dir)
    import suggestion_generator as sg  # noqa: WPS433（运行时注入的模块）

    for attribute in ("N_CAND", "MAX_NEW", "generate_suggestions"):
        if not hasattr(sg, attribute):
            raise RuntimeError("suggestion_generator lacks attribute: {0}".format(attribute))
    return sg


def sanitize_candidates(raw):
    """清洗 sg 输出：text 非空字符串、kind 归一、score 有限且落在 [0, 1]。

    json.dumps 默认允许 NaN/Infinity，但宿主 serde_json 无法解析——
    非有限分数一律归 0.0，杜绝非法 JSON 上线。
    """
    cleaned = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text:
            continue
        kind = item.get("kind")
        kind = kind if isinstance(kind, str) and kind else "word"
        score = item.get("score", 0.0)
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0
        if not math.isfinite(score):
            score = 0.0
        score = min(1.0, max(0.0, score))
        cleaned.append({"text": text, "kind": kind, "score": score})
        if len(cleaned) >= MAX_CANDIDATES:
            break
    return cleaned


def handle_configure(sg, request):
    fast = bool(request.get("fast", False))
    sg.N_CAND = FAST_N_CAND if fast else QUALITY_N_CAND
    sg.MAX_NEW = FAST_MAX_NEW if fast else QUALITY_MAX_NEW
    return {"fast": fast, "nCand": sg.N_CAND, "maxNew": sg.MAX_NEW}


def handle_warmup(sg, request):
    tier = request.get("tier", "32m")
    started = time.perf_counter()
    suggestions = sg.generate_suggestions("预热", lang_hint="zh", n=4, tier=tier)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {"warmupMs": elapsed_ms, "candidates": len(suggestions)}


def handle_generate(sg, request):
    prefix = request.get("prefix", "")
    if not isinstance(prefix, str):
        prefix = str(prefix)
    lang = request.get("lang", "zh")
    if lang not in ("zh", "en"):
        lang = "zh"
    try:
        n = int(request.get("n", MAX_CANDIDATES))
    except (TypeError, ValueError):
        n = MAX_CANDIDATES
    n = min(MAX_CANDIDATES, max(1, n))
    tier = request.get("tier", "32m")
    started = time.perf_counter()
    suggestions = sg.generate_suggestions(prefix, lang_hint=lang, n=n, tier=tier)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {"candidates": sanitize_candidates(suggestions), "elapsedMs": elapsed_ms}


def main():
    runtime_dir = parse_runtime_arg()
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass  # Python < 3.7 或非常规 stdin；宿主已设 PYTHONIOENCODING=utf-8

    protocol = open_protocol_stream()

    def respond(payload):
        protocol.write(json.dumps(payload, ensure_ascii=True, allow_nan=False) + "\n")

    try:
        sg = import_runtime(runtime_dir)
    except Exception as exc:  # noqa: BLE001（启动失败必须回协议帧而非裸栈）
        eprint("reink bridge: import failed: {0}: {1}".format(type(exc).__name__, exc))
        respond({"id": 0, "ok": False, "error": "import failed: {0}: {1}".format(
            type(exc).__name__, exc)})
        return 1

    respond({
        "id": 0,
        "ok": True,
        "data": {"bridge": "reink", "version": BRIDGE_VERSION, "runtime": runtime_dir},
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = -1
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request frame must be a JSON object")
            request_id = int(request.get("id", -1))
            op = request.get("op")
            if op == "configure":
                data = handle_configure(sg, request)
            elif op == "warmup":
                data = handle_warmup(sg, request)
            elif op == "generate":
                data = handle_generate(sg, request)
            elif op == "shutdown":
                respond({"id": request_id, "ok": True, "data": {"shutdown": True}})
                eprint("reink bridge: shutdown requested")
                return 0
            else:
                respond({
                    "id": request_id,
                    "ok": False,
                    "error": "unknown op: {0!r}".format(op),
                })
                continue
            respond({"id": request_id, "ok": True, "data": data})
        except Exception as exc:  # noqa: BLE001（单请求失败只回错误帧，不崩进程）
            eprint("reink bridge: op failed: {0}: {1}".format(type(exc).__name__, exc))
            respond({
                "id": request_id,
                "ok": False,
                "error": "{0}: {1}".format(type(exc).__name__, exc),
            })

    eprint("reink bridge: stdin EOF, exiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
