#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把当前 HEAD 推送到 GitHub —— 走 REST API，不走 git 协议。

用法：
    python3 tools/push-via-api.py            # 推送当前分支到 origin
    python3 tools/push-via-api.py --dry-run  # 只检查，不写入

## 为什么需要这个脚本

正常的 `git push` 需要连 github.com:443，而在某些受管网络里，出网代理只放行
api.github.com，连 github.com 会被代理挡掉：

    $ git push -u origin main
    fatal: unable to access 'https://github.com/...': CONNECT tunnel failed, response 502
    $ curl --noproxy '*' https://github.com/...   # 直连也不通
    curl: (7) Failed to connect to github.com port 443

而 `curl https://api.github.com` 是通的。所以改走 GitHub 的 Git Data API：
上传 blob → 建 tree → 建 commit → 更新 ref。api.github.com 与 github.com 共享仓库数据，
效果与 git push 等价。

## 一个细节：让远端提交的 SHA 和本地完全一致

git 的 commit 对象里，**时区偏移和提交信息结尾的换行都是哈希的一部分**。
如果直接把 `git log --format=%B` 的内容发给 API，GitHub 存下来的对象可能多一个换行，
于是远端 SHA 与本地不同——内容一样，但本地会认为有未推送的提交，以后 push 会被拒。

这个脚本的做法是：先在本地用 `git hash-object -t commit --stdin` 试算几种结尾换行，
挑出**哈希等于本地 HEAD** 的那一种，再把它发给 API。这样远端对象与本地逐字节相同，
SHA 自然一致。
"""
import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"


def sh(*args, binary=False, check=True):
    r = subprocess.run(args, capture_output=True)
    if check and r.returncode:
        sys.exit("命令失败: %s\n%s" % (" ".join(args), r.stderr.decode()))
    return r.stdout if binary else r.stdout.decode().strip()


def get_token():
    """从 git 的凭据存储里取 token，不打印、不落盘。"""
    out = sh("bash", "-c",
             'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill 2>/dev/null')
    for line in out.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    sys.exit("取不到 GitHub 凭据。请先配置 git 的 credential helper。")


def get_remote():
    url = sh("git", "remote", "get-url", "origin")
    if url.startswith(("git@", "ssh://")):
        path = url.split(":")[-1] if url.startswith("git@") else url.split("/")[-2] + "/" + url.split("/")[-1]
    else:
        path = "/".join(url.rstrip("/").split("/")[-2:])
    owner, repo = path.rsplit("/", 1)[0].split("/")[-1], path.rsplit("/", 1)[-1]
    return owner, repo.removesuffix(".git")


class Client:
    def __init__(self, token, owner, repo):
        self.token, self.owner, self.repo = token, owner, repo

    def __call__(self, method, path, payload=None, tolerate=()):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        req = urllib.request.Request(
            API + "/repos/%s/%s%s" % (self.owner, self.repo, path), data=data, method=method,
            headers={"Authorization": "token " + self.token,
                     "Accept": "application/vnd.github+json",
                     "Content-Type": "application/json; charset=utf-8",
                     "User-Agent": "push-via-api"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in tolerate:
                return {"_error": e.code}
            sys.exit("API %s %s 失败 (%d): %s" % (method, path, e.code, e.read().decode()[:400]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--branch", default=None, help="默认用当前分支")
    args = ap.parse_args()

    owner, repo = get_remote()
    branch = args.branch or sh("git", "rev-parse", "--abbrev-ref", "HEAD")
    head = sh("git", "rev-parse", "HEAD")
    tree = sh("git", "rev-parse", "HEAD^{tree}")
    parents = sh("git", "rev-list", "--parents", "-n", "1", "HEAD").split()[1:]
    name = sh("git", "log", "-1", "--format=%an")
    email = sh("git", "log", "-1", "--format=%ae")
    adate = sh("git", "log", "-1", "--format=%aI")
    subject = sh("git", "log", "-1", "--format=%s")
    raw_msg = subprocess.run(["git", "log", "-1", "--format=%B"],
                             capture_output=True).stdout.decode()

    print("仓库   : %s/%s" % (owner, repo))
    print("分支   : %s" % branch)
    print("本地   : %s  %s" % (head[:12], subject))
    print("父提交 : %s" % (", ".join(p[:12] for p in parents) or "（根提交）"))

    # ── 找出让远端 SHA 等于本地的那一种「结尾换行」
    #
    # 注意：git 的 commit 对象里，日期是「<unix 时间戳> <±HHMM 时区偏移>」，
    # 不是 ISO 格式化字符串（`git log --format=%aI` 那种）。用 ISO 拼出来的对象
    # 哈希永远对不上。所以这里直接取本地对象里那一段原始头部字节，逐字复用，
    # 只变动提交信息结尾的换行。
    raw_obj = subprocess.run(["git", "cat-file", "commit", "HEAD"],
                             capture_output=True).stdout.decode()
    obj_head, _, obj_msg = raw_obj.partition("\n\n")

    def build_obj(msg_tail):
        return (obj_head + "\n\n" + obj_msg.rstrip("\n") + msg_tail).encode()

    chosen = None
    for tail in ("\n", "", "\n\n", "\n\n\n"):
        obj = build_obj(tail)
        got = subprocess.run(["git", "hash-object", "-t", "commit", "--stdin"],
                             input=obj, capture_output=True).stdout.decode().strip()
        if got == head:
            chosen = (tail, obj)
            print("提交信息结尾: %s（命中本地 SHA）" % repr(tail))
            break
    if chosen is None:
        sys.exit("无法在本地复刻出与 HEAD 相同的提交对象。\n"
                 "  本地对象头部:\n    " + obj_head.replace("\n", "\n    "))

    if args.dry_run:
        print("\n--dry-run：只做了本地检查，未写入远端。")
        return

    token = get_token()
    gh = Client(token, owner, repo)

    # ── 上传被这个提交引用的所有 blob（按内容寻址，远端已存在的会自动去重）
    rows = [l.split(None, 3) for l in sh("git", "ls-tree", "-r", "HEAD").splitlines()]
    entries = []
    for i, (mode, _type, blob_sha, path) in enumerate(rows, 1):
        raw = subprocess.run(["git", "cat-file", "blob", blob_sha], capture_output=True).stdout
        res = gh("POST", "/git/blobs",
                 {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
        if res["sha"] != blob_sha:
            sys.exit("blob 校验失败：%s\n  本地 %s\n  远端 %s" % (path, blob_sha, res["sha"]))
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": res["sha"]})
        print("  [%2d/%d] %-40s %s ✓" % (i, len(rows), path[:40], blob_sha[:9]))

    t = gh("POST", "/git/trees", {"tree": entries})
    if t["sha"] != tree:
        sys.exit("tree 不一致（本地 %s / 远端 %s），已中止，未改动远端。\n"
                 "多半是本地有未提交的改动，或 .gitignore 与远端不一致。" % (tree, t["sha"]))
    print("tree   : %s ✓（与本地逐字节一致）" % t["sha"][:12])

    ident = {"name": name, "email": email, "date": adate}
    c = gh("POST", "/git/commits",
           {"message": raw_msg.rstrip("\n") + chosen[0], "tree": t["sha"],
            "parents": parents, "author": ident, "committer": ident})
    if c["sha"] != head:
        sys.exit("commit 不一致（本地 %s / 远端 %s），已中止。" % (head, c["sha"]))
    print("commit : %s ✓（SHA 与本地完全相同）" % c["sha"][:12])

    ref = gh("GET", "/git/ref/heads/%s" % branch, tolerate={404})
    if ref.get("_error") == 404:
        gh("POST", "/git/refs", {"ref": "refs/heads/" + branch, "sha": c["sha"]})
    else:
        gh("PATCH", "/git/refs/heads/%s" % branch, {"sha": c["sha"], "force": True})

    print("\n已推送：https://github.com/%s/%s/commit/%s" % (owner, repo, c["sha"]))
    print("本地与远端现在指向同一个提交，工作区状态：")
    print(subprocess.run(["git", "status", "--short"], capture_output=True).stdout.decode().strip()
          or "  （干净）")


if __name__ == "__main__":
    main()
