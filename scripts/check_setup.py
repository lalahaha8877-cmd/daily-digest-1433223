"""配置自检：逐项验证外部服务是否真的连通。

用法（在项目根目录）：
    py scripts/check_setup.py            # 检查全部
    py scripts/check_setup.py supabase   # 只查一项：supabase / r2 / anthropic

读取项目根目录的 .env。每一项独立检查，一项没配好不影响其他项的结果。
本脚本只做只读/临时写入，不会碰你的真实数据。
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

# Windows 控制台默认不是 UTF-8（简中系统常见 cp936，英文系统 cp1252），
# 直接 print 中文会抛 UnicodeEncodeError。必须先把 stdout 改成 UTF-8，
# 否则脚本会在第一行输出就崩掉。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# 老版本 Windows 控制台不认 ANSI 转义序列，会把颜色码原样打印成乱码。
# Windows Terminal / VS Code 终端没问题，cmd.exe 视版本而定 —— 无法确定时不上色。
_USE_COLOR = sys.stdout.isatty() and (
    os.name != "nt" or os.environ.get("WT_SESSION") or os.environ.get("TERM")
)

ROOT = Path(__file__).resolve().parent.parent

if _USE_COLOR:
    GREEN, RED, YELLOW, DIM, RESET = (
        "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m",
    )
else:
    GREEN = RED = YELLOW = DIM = RESET = ""

OK, FAIL, SKIP = f"{GREEN}[OK]{RESET}", f"{RED}[!!]{RESET}", f"{YELLOW}[--]{RESET}"

REQUIRED_TABLES = {"keywords", "runs", "digests", "items", "exports"}


def images_backend() -> str:
    return os.environ.get("IMAGES_BACKEND", "supabase").strip().lower()


def required_supabase_buckets() -> set[str]:
    """配图走 Supabase 时，images 桶也建在 Supabase。"""
    buckets = {"fulltext", "exports"}
    if images_backend() != "r2":
        buckets.add("images")
    return buckets


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        print(f"{FAIL} 找不到 {env_path}")
        print(f"  {DIM}先复制模板：copy .env.example .env{RESET}")
        sys.exit(1)
    try:
        from dotenv import load_dotenv
    except ImportError:
        print(f"{FAIL} 缺少 python-dotenv：py -m pip install python-dotenv")
        sys.exit(1)
    load_dotenv(env_path)


def missing(*names: str) -> list[str]:
    return [n for n in names if not os.environ.get(n)]


# ── Supabase ─────────────────────────────────────────────
def check_supabase() -> bool:
    print("\n【Supabase】")
    gap = missing("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
    if gap:
        print(f"{SKIP} 未配置：{', '.join(gap)}")
        return False

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]

    # service_role 的 JWT 里 role 字段是 service_role；anon key 是最常见的贴错
    if "anon" in key[:200] or len(key) < 60:
        print(f"{YELLOW}[?]{RESET} 这个 key 看起来不像 service_role —— 确认不是复制成 anon key 了")

    try:
        from supabase import create_client
    except ImportError:
        print(f"{FAIL} 缺少 supabase：py -m pip install supabase")
        return False

    try:
        client = create_client(url, key)
    except Exception as e:
        print(f"{FAIL} 创建客户端失败：{e}")
        return False

    ok = True

    # 1. 表是否建好
    for table in sorted(REQUIRED_TABLES):
        try:
            client.table(table).select("*", count="exact").limit(0).execute()
            print(f"{OK} 表 {table}")
        except Exception as e:
            msg = str(e)
            hint = "  → 还没执行 db/schema.sql？" if "does not exist" in msg or "42P01" in msg else ""
            print(f"{FAIL} 表 {table}：{msg[:120]}{hint}")
            ok = False

    # 2. bucket 是否建好
    try:
        buckets = {b.name if hasattr(b, "name") else b["name"] for b in client.storage.list_buckets()}
        for want in sorted(required_supabase_buckets()):
            if want in buckets:
                print(f"{OK} bucket {want}")
            else:
                print(f"{FAIL} bucket {want} 不存在 → 在 Storage 里新建（不要勾 Public）")
                ok = False
    except Exception as e:
        print(f"{FAIL} 读取 bucket 列表失败：{str(e)[:120]}")
        ok = False

    return ok


# ── Cloudflare R2 ────────────────────────────────────────
def check_r2() -> bool:
    print("\n【Cloudflare R2】")

    if images_backend() != "r2":
        print(f"{SKIP} 配图走 Supabase（IMAGES_BACKEND=supabase），本项无需配置")
        print(f"  {DIM}关键词多到两位数、或大量使用收藏之后再考虑切到 R2{RESET}")
        return True                      # 不算失败：这是正常的默认配置

    gap = missing("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
    if gap:
        print(f"{FAIL} IMAGES_BACKEND=r2 但缺少：{', '.join(gap)}")
        return False

    bucket = os.environ.get("R2_BUCKET_IMAGES", "images")

    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        print(f"{FAIL} 缺少 boto3：py -m pip install boto3")
        return False

    endpoint = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
    except Exception as e:
        print(f"{FAIL} 创建 S3 客户端失败：{e}")
        return False

    try:
        s3.head_bucket(Bucket=bucket)
        print(f"{OK} bucket {bucket} 可访问")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "?")
        hint = f" → bucket 名字对不上？当前找的是 {bucket!r}" if code in ("404", "NoSuchBucket") else ""
        print(f"{FAIL} 访问 bucket 失败（{code}）{hint}")
        return False
    except Exception as e:
        print(f"{FAIL} 访问 bucket 失败：{str(e)[:150]}")
        return False

    # 写→读→签名→删，走一遍真实往返
    test_key = f"_setup_check/{uuid.uuid4().hex}.txt"
    payload = b"daily-digest-v2 setup check"
    try:
        s3.put_object(Bucket=bucket, Key=test_key, Body=payload, ContentType="text/plain")
        print(f"{OK} 写入测试对象")

        got = s3.get_object(Bucket=bucket, Key=test_key)["Body"].read()
        print(f"{OK} 读回一致" if got == payload else f"{FAIL} 读回内容不一致")

        signed = s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": test_key}, ExpiresIn=3600
        )
        print(f"{OK} 生成签名 URL（{len(signed)} 字符）")
    except Exception as e:
        print(f"{FAIL} 读写测试失败：{str(e)[:150]}")
        return False
    finally:
        try:
            s3.delete_object(Bucket=bucket, Key=test_key)
            print(f"{OK} 清理测试对象")
        except Exception:
            print(f"{YELLOW}[?]{RESET} 测试对象未能删除：{test_key}（可手动删）")

    return True


# ── Anthropic ────────────────────────────────────────────
def check_anthropic() -> bool:
    print("\n【Anthropic API】")
    if missing("ANTHROPIC_API_KEY"):
        print(f"{SKIP} 未配置：ANTHROPIC_API_KEY")
        return False

    try:
        import anthropic
    except ImportError:
        print(f"{FAIL} 缺少 anthropic：py -m pip install anthropic")
        return False

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    for label, env_name, default in (
        ("预筛模型", "MODEL_SCREEN", "claude-haiku-4-5-20251001"),
        ("提炼模型", "MODEL_DISTILL", "claude-sonnet-5"),
    ):
        model = os.environ.get(env_name) or default
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=8,
                messages=[{"role": "user", "content": "reply with: ok"}],
            )
            used = resp.usage.input_tokens + resp.usage.output_tokens
            print(f"{OK} {label} {model}（本次消耗 {used} tokens）")
        except anthropic.AuthenticationError:
            print(f"{FAIL} {label}：API Key 无效")
            return False
        except anthropic.NotFoundError:
            print(f"{FAIL} {label}：模型标识 {model!r} 不存在 → 检查 {env_name}")
            return False
        except Exception as e:
            msg = str(e)
            if "credit" in msg.lower() or "billing" in msg.lower():
                print(f"{FAIL} {label}：额度不足 → 去 console 充值")
            else:
                print(f"{FAIL} {label}：{msg[:150]}")
            return False

    return True


CHECKS = {"supabase": check_supabase, "r2": check_r2, "anthropic": check_anthropic}


def main() -> int:
    load_env()
    wanted = sys.argv[1:] or list(CHECKS)

    unknown = [w for w in wanted if w not in CHECKS]
    if unknown:
        print(f"未知的检查项：{', '.join(unknown)}")
        print(f"可用：{', '.join(CHECKS)}")
        return 2

    results = {name: CHECKS[name]() for name in wanted}

    print("\n" + "─" * 46)
    for name, passed in results.items():
        print(f"  {OK if passed else FAIL} {name}")

    if all(results.values()):
        print(f"\n{GREEN}全部通过，可以进入下一步。{RESET}")
        return 0
    print(f"\n{YELLOW}还有未通过项，按上面的提示处理后重跑。{RESET}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
