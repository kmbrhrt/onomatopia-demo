#!/usr/bin/env python3
"""中間発表用の体験サイトを作る（サーバーなし・① オノマトペを作る だけ）。

装置の画面（recorder/app）をそのままコピーし、体験サイト用に少しだけ書き換えて docs/ に出す。
装置の画面を直したら、これを実行し直せば体験サイトにも反映される。
    python3 build.py
書き換える場所が装置側で変わって見つからないときは、止まって知らせる。
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "recorder", "app")
OUT = os.path.join(HERE, "docs")

# そのまま使うファイル（DotGothic16-400.woff2 は使っていないので入れない）
COPY = ["app.js", "style.css", "fonts.css", "win.css", "qrcode.js", "index.html",
        "fonts/DotGothic16-Regular.ttf", "fonts/NotoSansJP-400.woff2", "fonts/NotoSansJP-700.woff2",
        "fonts/BIZUDPGothic-400.woff2", "fonts/BIZUDPGothic-700.woff2",
        "fonts/MPLUS1Code-400.woff2", "fonts/MPLUS1Code-700.woff2", "fonts/KosugiMaru-400.woff2"]

# (ファイル, 元の文字列, 置き換え, 置き換える回数)
PATCH = [
    # レシートの上の名前 → 「テスト用です」だけにする
    ("app.js", "const AUTHOR = 'Kambara haruta (Date Lab)';", "const AUTHOR = 'テスト用です';", 1),
    # 印刷しない。レシートは画面に出す
    ("app.js", "const PREVIEW = new URLSearchParams(location.search).has('preview');",
     "const PREVIEW = true;", 1),
    ("app.js", "showOverlay('done', 'レシートを受け取ってください', true);",
     "showOverlay('done', '展示では、このレシートがプリンターから出てきます。左の紙は上下に動かして全体を見られます', true);", 1),
    # ② ③ は遊べない
    ("app.js", "{ label: '② オノマトペを組み合わせる', value: 'idea' },",
     "{ label: '② オノマトペを組み合わせる（展示のみ）', value: 'idea' },", 1),
    ("app.js", "{ label: '③ 評価する', value: 'evaluate' },",
     "{ label: '③ 評価する（展示のみ）', value: 'evaluate' },", 1),
    ("app.js", "idea: [stepScan, stepIdea, stepWhy, stepPrintIdea],", "idea: [stepDemoOnly],", 1),
    ("app.js", "evaluate: [stepEvaluate] }", "evaluate: [stepDemoOnly] }", 1),
    # タイトルの名前の欄
    ("index.html", '<div class="t-name">KAMBARA HARUTA [Date Lab]</div>',
     '<div class="t-name">テスト用の体験サイトです</div>', 1),
    ("index.html", "<title>ONOMATOPIA — RECORD</title>", "<title>ONOMATOPIA — 体験サイト（テスト用）</title>", 1),
    # 関係者用の隅（展示を終える・音のテスト）は外す
    ("index.html", '<div id="quit"></div>\n<div id="sound"></div>\n', "", 1),
    # 紙の切り取り方の動画 → できたレシートの画像
    ("index.html",
     '<video id="ov-video" src="media/tear.mp4?v=4" muted loop playsinline preload="auto" hidden></video>',
     '<div id="ov-receipt" hidden><img alt="できたレシート"></div>', 1),
    ("index.html",
     '<button id="ov-again" class="box">reprint</button><small>もう一度印刷</small>',
     '<button id="ov-again" class="box">save</button><small>画像を保存</small>', 1),
    ("index.html", '<link rel="stylesheet" href="win.css?v=8">',
     '<link rel="stylesheet" href="win.css?v=8">\n<link rel="stylesheet" href="demo.css">', 1),
    ("index.html", '<script src="jsQR.js"></script>\n', "", 1),
    ("index.html", '<script src="app.js?v=73"></script>',
     '<script src="app.js?v=73"></script>\n<script src="demo.js"></script>\n\n'
     '<!-- スマホが縦向きのとき -->\n'
     '<div id="rotate"><div class="win solo"><div class="win-bar"><div class="win-title">rotate</div></div>'
     '<div class="win-body"><div class="rot-big">スマホを横向きにしてね</div>'
     '<div class="rot-sub">画面の回転ロックは外してください</div></div></div></div>', 1),
]


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "fonts"))
    for f in COPY:
        shutil.copy(os.path.join(SRC, f), os.path.join(OUT, f))
    for f in ["demo.js", "demo.css"]:
        shutil.copy(os.path.join(HERE, f), os.path.join(OUT, f))
    open(os.path.join(OUT, ".nojekyll"), "w").close()   # GitHub Pages にそのまま出させる

    for name, old, new, n in PATCH:
        p = os.path.join(OUT, name)
        s = open(p, encoding="utf-8").read()
        if old not in s:
            raise SystemExit(f"見つかりません（装置側が変わった？）: {name}: {old[:50]}")
        s = s.replace(old, new, n)
        open(p, "w", encoding="utf-8").write(s)
    print("docs/ に書き出しました")


if __name__ == "__main__":
    main()
